from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.models.audit import AuditLog
from app.models.enums import InventoryReason
from app.models.inventory import InventoryLedger
from app.testing import (
    approve_po,
    create_and_post_grn,
    create_po,
    create_product,
    create_superuser_headers,
    create_supplier,
    create_warehouse,
)


def _seed_stock(client: TestClient, db: Session) -> dict[str, object]:
    headers, user = create_superuser_headers(db, "stock-adjustment-admin@medhaone.app")
    supplier_id = create_supplier(client, headers, "Stock Adjustment Supplier")
    warehouse_id = create_warehouse(client, headers, "SADJ")
    product_id = create_product(client, headers, "SADJ-SKU-1")

    po = create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
        ordered_qty="10",
        unit_cost="20.00",
        order_date=date.today().isoformat(),
    )
    approve_po(client, headers, po["id"])

    grn = create_and_post_grn(
        client,
        headers,
        po_id=po["id"],
        po_line_id=po["lines"][0]["id"],
        received_qty="10",
        batch_no="SADJ-BATCH-1",
        expiry_date="2030-12-31",
        received_date=date.today().isoformat(),
    )

    return {
        "headers": headers,
        "user_id": user.id,
        "warehouse_id": warehouse_id,
        "product_id": product_id,
        "batch_id": grn["lines"][0]["batch_id"],
    }


def test_positive_stock_adjustment_increases_stock(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(client, db)

    response = client.post(
        "/inventory/stock-adjustments",
        headers=seeded["headers"],
        json={
            "warehouse_id": seeded["warehouse_id"],
            "product_id": seeded["product_id"],
            "batch_id": seeded["batch_id"],
            "adjustment_type": "POSITIVE",
            "qty": "2",
            "reason": "FOUND_STOCK",
            "remarks": "Counted extra units",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert Decimal(str(payload["before_qty"])) == Decimal("10")
    assert Decimal(str(payload["after_qty"])) == Decimal("12")

    ledger = db.get(InventoryLedger, payload["ledger_id"])
    assert ledger is not None
    assert ledger.reason == InventoryReason.STOCK_ADJUSTMENT
    assert Decimal(str(ledger.qty)) == Decimal("2")


def test_negative_stock_adjustment_decreases_stock_and_writes_audit(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(client, db)

    response = client.post(
        "/inventory/stock-adjustments",
        headers=seeded["headers"],
        json={
            "warehouse_id": seeded["warehouse_id"],
            "product_id": seeded["product_id"],
            "batch_id": seeded["batch_id"],
            "adjustment_type": "NEGATIVE",
            "qty": "3",
            "reason": "DAMAGED",
            "remarks": "Broken during handling",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert Decimal(str(payload["before_qty"])) == Decimal("10")
    assert Decimal(str(payload["after_qty"])) == Decimal("7")

    audit_log = (
        db.query(AuditLog)
        .filter(AuditLog.entity_type == "STOCK_ADJUSTMENT", AuditLog.entity_id == payload["id"])
        .one()
    )
    assert audit_log.module == "Stock Adjustment"
    assert audit_log.action == "ADJUST"
    assert audit_log.reason == "DAMAGED"


def test_negative_stock_adjustment_cannot_reduce_below_available(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(client, db)

    response = client.post(
        "/inventory/stock-adjustments",
        headers=seeded["headers"],
        json={
            "warehouse_id": seeded["warehouse_id"],
            "product_id": seeded["product_id"],
            "batch_id": seeded["batch_id"],
            "adjustment_type": "NEGATIVE",
            "qty": "50",
            "reason": "DAMAGED",
        },
    )
    assert response.status_code == 400
    assert response.json()["error_code"] == "INSUFFICIENT_STOCK"


def test_stock_adjustment_reason_is_mandatory_and_other_requires_remarks(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(client, db)

    missing_reason = client.post(
        "/inventory/stock-adjustments",
        headers=seeded["headers"],
        json={
            "warehouse_id": seeded["warehouse_id"],
            "product_id": seeded["product_id"],
            "batch_id": seeded["batch_id"],
            "adjustment_type": "POSITIVE",
            "qty": "1",
        },
    )
    assert missing_reason.status_code == 422

    other_without_remarks = client.post(
        "/inventory/stock-adjustments",
        headers=seeded["headers"],
        json={
            "warehouse_id": seeded["warehouse_id"],
            "product_id": seeded["product_id"],
            "batch_id": seeded["batch_id"],
            "adjustment_type": "POSITIVE",
            "qty": "1",
            "reason": "OTHER",
        },
    )
    assert other_without_remarks.status_code == 400
    assert other_without_remarks.json()["message"] == "Remarks are required when adjustment reason is OTHER."


def test_stock_adjustment_list_returns_recent_adjustments(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(client, db)

    create_response = client.post(
        "/inventory/stock-adjustments",
        headers=seeded["headers"],
        json={
            "warehouse_id": seeded["warehouse_id"],
            "product_id": seeded["product_id"],
            "batch_id": seeded["batch_id"],
            "adjustment_type": "POSITIVE",
            "qty": "2",
            "reason": "FOUND_STOCK",
            "remarks": "List coverage",
        },
    )
    assert create_response.status_code == 200, create_response.text

    list_response = client.get(
        "/inventory/stock-adjustments",
        headers=seeded["headers"],
        params={"page": 1, "page_size": 10},
    )
    assert list_response.status_code == 200, list_response.text
    payload = list_response.json()
    assert payload["total"] >= 1
    record = payload["data"][0]
    assert record["adjustment_type"] == "POSITIVE"
    assert record["reason"] == "FOUND_STOCK"
    assert record["batch_no"] == "SADJ-BATCH-1"


def test_stock_adjustment_list_gracefully_handles_incompatible_tenant_schema(
    client_with_test_db: tuple[TestClient, Session],
    monkeypatch,
) -> None:
    client, db = client_with_test_db
    headers, _ = create_superuser_headers(db, "stock-adjustment-list-fallback@medhaone.app")

    def _raise_incompatible(_db):
        raise AppException(
            error_code="TENANT_SCHEMA_INCOMPATIBLE",
            message="schema incompatible",
            status_code=409,
        )

    monkeypatch.setattr("app.api.routes.inventory._ensure_stock_ops_schema_ready", _raise_incompatible)

    response = client.get("/inventory/stock-adjustments?page=1&page_size=10", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 0
    assert payload["data"] == []
