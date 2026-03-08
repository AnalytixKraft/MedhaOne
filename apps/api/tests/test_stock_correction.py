from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.models.audit import AuditLog
from app.models.enums import InventoryReason, InventoryTxnType
from app.models.inventory import InventoryLedger
from app.models.stock_operations import StockCorrection
from app.testing import (
    approve_po,
    create_and_post_grn,
    create_po,
    create_product,
    create_restricted_headers,
    create_superuser_headers,
    create_supplier,
    create_warehouse,
)


def _seed_stock(client: TestClient, db: Session) -> dict[str, object]:
    headers, user = create_superuser_headers(db, "stock-correction-admin@medhaone.app")
    supplier_id = create_supplier(client, headers, "Stock Correction Supplier")
    warehouse_id = create_warehouse(client, headers, "SCORR")
    product_id = create_product(client, headers, "SCORR-SKU-1")

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
        batch_no="SCORR-BATCH-1",
        expiry_date="2030-12-31",
        received_date=date.today().isoformat(),
    )

    return {
        "headers": headers,
        "user_id": user.id,
        "warehouse_id": warehouse_id,
        "product_id": product_id,
        "source_batch_id": grn["lines"][0]["batch_id"],
    }


def test_stock_correction_reclassifies_without_net_stock_change(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(client, db)

    correction_response = client.post(
        "/inventory/stock-corrections",
        headers=seeded["headers"],
        json={
            "warehouse_id": seeded["warehouse_id"],
            "product_id": seeded["product_id"],
            "source_batch_id": seeded["source_batch_id"],
            "qty_to_reclassify": "4",
            "corrected_batch_no": "SCORR-BATCH-1",
            "corrected_expiry_date": "2031-06-30",
            "reference_id": "SCORR-REF-1",
            "reason": "Wrong expiry posted at GRN",
            "remarks": "Move to corrected expiry bucket",
        },
    )
    assert correction_response.status_code == 200, correction_response.text
    correction_payload = correction_response.json()

    assert correction_payload["reference_id"] == "SCORR-REF-1"
    assert correction_payload["source_batch_id"] == seeded["source_batch_id"]
    assert correction_payload["corrected_batch_id"] != seeded["source_batch_id"]
    assert Decimal(str(correction_payload["qty_to_reclassify"])) == Decimal("4")
    assert Decimal(str(correction_payload["source_qty_on_hand"])) == Decimal("6")
    assert Decimal(str(correction_payload["corrected_qty_on_hand"])) == Decimal("4")

    stock_items_response = client.get(
        "/inventory/stock-items",
        headers=seeded["headers"],
        params={
            "warehouse_id": seeded["warehouse_id"],
            "product_id": seeded["product_id"],
        },
    )
    assert stock_items_response.status_code == 200, stock_items_response.text
    stock_payload = stock_items_response.json()
    assert stock_payload["total"] == 2
    total_on_hand = sum(Decimal(str(item["qty_on_hand"])) for item in stock_payload["data"])
    assert total_on_hand == Decimal("10")

    source_row = next(
        item for item in stock_payload["data"] if item["batch_id"] == seeded["source_batch_id"]
    )
    corrected_row = next(
        item
        for item in stock_payload["data"]
        if item["batch_id"] == correction_payload["corrected_batch_id"]
    )
    assert Decimal(str(source_row["qty_on_hand"])) == Decimal("6")
    assert Decimal(str(corrected_row["qty_on_hand"])) == Decimal("4")

    correction = db.query(StockCorrection).filter(StockCorrection.reference_id == "SCORR-REF-1").one()
    ledgers = (
        db.query(InventoryLedger)
        .filter(InventoryLedger.ref_type == "STOCK_CORRECTION", InventoryLedger.ref_id == "SCORR-REF-1")
        .order_by(InventoryLedger.id.asc())
        .all()
    )
    assert len(ledgers) == 2
    assert {ledger.reason for ledger in ledgers} == {
        InventoryReason.STOCK_CORRECTION_OUT,
        InventoryReason.STOCK_CORRECTION_IN,
    }
    assert {ledger.txn_type for ledger in ledgers} == {InventoryTxnType.OUT, InventoryTxnType.IN}
    assert sorted(Decimal(str(ledger.qty)) for ledger in ledgers) == [Decimal("-4"), Decimal("4")]
    assert correction.out_ledger_id in {ledger.id for ledger in ledgers}
    assert correction.in_ledger_id in {ledger.id for ledger in ledgers}


def test_stock_correction_cannot_reclassify_more_than_source_qty(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(client, db)

    response = client.post(
        "/inventory/stock-corrections",
        headers=seeded["headers"],
        json={
            "warehouse_id": seeded["warehouse_id"],
            "product_id": seeded["product_id"],
            "source_batch_id": seeded["source_batch_id"],
            "qty_to_reclassify": "40",
            "corrected_batch_no": "SCORR-BATCH-2",
            "corrected_expiry_date": "2031-06-30",
            "reason": "Wrong expiry posted at GRN",
        },
    )

    assert response.status_code == 400
    assert response.json()["error_code"] == "INSUFFICIENT_STOCK"


def test_stock_correction_writes_audit_record(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(client, db)

    response = client.post(
        "/inventory/stock-corrections",
        headers=seeded["headers"],
        json={
            "warehouse_id": seeded["warehouse_id"],
            "product_id": seeded["product_id"],
            "source_batch_id": seeded["source_batch_id"],
            "qty_to_reclassify": "2",
            "corrected_batch_no": "SCORR-BATCH-1",
            "corrected_expiry_date": "2031-06-30",
            "reason": "Wrong expiry posted at GRN",
            "remarks": "Audit verification",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    audit_log = (
        db.query(AuditLog)
        .filter(AuditLog.entity_type == "STOCK_CORRECTION", AuditLog.entity_id == payload["id"])
        .one()
    )
    assert audit_log.module == "Stock Correction"
    assert audit_log.action == "CORRECT"
    assert audit_log.reason == "Wrong expiry posted at GRN"


def test_stock_correction_requires_apply_permission(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(client, db)
    restricted_headers = create_restricted_headers(db, "scorr-restricted@medhaone.app")

    response = client.post(
        "/inventory/stock-corrections",
        headers=restricted_headers,
        json={
            "warehouse_id": seeded["warehouse_id"],
            "product_id": seeded["product_id"],
            "source_batch_id": seeded["source_batch_id"],
            "qty_to_reclassify": "1",
            "corrected_batch_no": "SCORR-BATCH-1",
            "corrected_expiry_date": "2031-06-30",
            "reason": "Wrong expiry posted at GRN",
        },
    )

    assert response.status_code == 403
    assert response.json()["error_code"] == "FORBIDDEN"


def test_stock_correction_accepts_dd_mm_yyyy_date_format(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(client, db)

    response = client.post(
        "/inventory/stock-corrections",
        headers=seeded["headers"],
        json={
            "warehouse_id": seeded["warehouse_id"],
            "product_id": seeded["product_id"],
            "source_batch_id": seeded["source_batch_id"],
            "qty_to_reclassify": "1",
            "corrected_batch_no": "SCORR-BATCH-2",
            "corrected_expiry_date": "31/01/2031",
            "reference_id": "SCORR-REF-DDMM",
            "reason": "Wrong expiry posted at GRN",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["reference_id"] == "SCORR-REF-DDMM"


def test_stock_correction_list_gracefully_handles_incompatible_tenant_schema(
    client_with_test_db: tuple[TestClient, Session],
    monkeypatch,
) -> None:
    client, db = client_with_test_db
    headers, _ = create_superuser_headers(db, "stock-correction-list-fallback@medhaone.app")

    def _raise_incompatible(_db):
        raise AppException(
            error_code="TENANT_SCHEMA_INCOMPATIBLE",
            message="schema incompatible",
            status_code=409,
        )

    monkeypatch.setattr("app.api.routes.inventory._ensure_stock_ops_schema_ready", _raise_incompatible)

    response = client.get("/inventory/stock-corrections?page=1&page_size=10", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 0
    assert payload["data"] == []
