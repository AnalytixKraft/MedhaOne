from datetime import date
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.routes.audit import _build_legacy_audit_row, _filter_legacy_rows
from app.testing import (
    approve_po,
    create_and_post_grn,
    create_po,
    create_product,
    create_superuser_headers,
    create_supplier,
    create_warehouse,
)


def _seed_and_adjust(client: TestClient, db: Session) -> dict[str, object]:
    headers, user = create_superuser_headers(db, "audit-admin@medhaone.app")
    supplier_id = create_supplier(client, headers, "Audit Supplier")
    warehouse_id = create_warehouse(client, headers, "AUD")
    product_id = create_product(client, headers, "AUD-SKU-1")

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
        batch_no="AUD-BATCH-1",
        expiry_date="2030-12-31",
        received_date=date.today().isoformat(),
    )

    adjustment_response = client.post(
        "/inventory/stock-adjustments",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": grn["lines"][0]["batch_id"],
            "adjustment_type": "POSITIVE",
            "qty": "1",
            "reason": "FOUND_STOCK",
            "remarks": "Audit route coverage",
        },
    )
    assert adjustment_response.status_code == 200, adjustment_response.text
    return {"headers": headers, "user_id": user.id, "adjustment_id": adjustment_response.json()["id"]}


def test_audit_filter_by_user_module_and_date_works(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_and_adjust(client, db)

    response = client.get(
        "/settings/audit-trail",
        headers=seeded["headers"],
        params={
            "user_id": seeded["user_id"],
            "module": "Stock Adjustment",
            "date_from": f"{date.today().isoformat()}T00:00:00",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] >= 1
    assert all(row["module"] == "Stock Adjustment" for row in payload["data"])


def test_record_history_endpoint_returns_adjustment_history(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_and_adjust(client, db)

    response = client.get(
        f"/settings/history/STOCK_ADJUSTMENT/{seeded['adjustment_id']}",
        headers=seeded["headers"],
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["entity_type"] == "STOCK_ADJUSTMENT"
    assert payload["entity_id"] == seeded["adjustment_id"]
    assert len(payload["entries"]) >= 1


def test_legacy_audit_row_normalization_supports_text_ids() -> None:
    row = _build_legacy_audit_row(
        {
            "id": "ecc234a9-6d6b-4889-a67d-2f4b96398500",
            "actor_user_id": "9892de68-e263-4c29-b64e-9697ef78784d",
            "action": "ORG_USER_LOGIN",
            "target_type": "USER",
            "target_id": "9892de68-e263-4c29-b64e-9697ef78784d",
            "metadata": {
                "summary": "User logged in through org auth",
                "remarks": "Legacy record",
            },
            "created_at": datetime(2026, 3, 8, tzinfo=timezone.utc),
        }
    )

    assert row.id == "ecc234a9-6d6b-4889-a67d-2f4b96398500"
    assert row.user_id == "9892de68-e263-4c29-b64e-9697ef78784d"
    assert row.entity_id == "9892de68-e263-4c29-b64e-9697ef78784d"
    assert row.module == "Users"
    assert row.summary == "User logged in through org auth"


def test_legacy_audit_filtering_uses_normalized_module_and_search() -> None:
    rows = [
        _build_legacy_audit_row(
            {
                "id": "1",
                "actor_user_id": "abc",
                "action": "ORG_USER_LOGIN",
                "target_type": "USER",
                "target_id": "abc",
                "metadata": {"summary": "User login"},
                "created_at": datetime(2026, 3, 8, tzinfo=timezone.utc),
            }
        ),
        _build_legacy_audit_row(
            {
                "id": "2",
                "actor_user_id": "2",
                "action": "STOCK_ADJUSTMENT",
                "target_type": "STOCK_ADJUSTMENT",
                "target_id": "12",
                "metadata": {"module": "Stock Adjustment", "summary": "Adjusted batch"},
                "created_at": datetime(2026, 3, 8, tzinfo=timezone.utc),
            }
        ),
    ]

    filtered = _filter_legacy_rows(rows, module="Stock Adjustment", search="batch")

    assert [row.id for row in filtered] == ["2"]


def test_legacy_audit_filtering_excludes_login_logout_noise() -> None:
    rows = [
        _build_legacy_audit_row(
            {
                "id": "1",
                "actor_user_id": "abc",
                "action": "ORG_USER_LOGIN",
                "target_type": "USER",
                "target_id": "abc",
                "metadata": {"summary": "User login"},
                "created_at": datetime(2026, 3, 8, tzinfo=timezone.utc),
            }
        ),
        _build_legacy_audit_row(
            {
                "id": "2",
                "actor_user_id": "2",
                "action": "UPDATE",
                "target_type": "PRODUCT",
                "target_id": "12",
                "metadata": {"module": "Inventory", "summary": "Updated product"},
                "created_at": datetime(2026, 3, 8, tzinfo=timezone.utc),
            }
        ),
    ]

    filtered = _filter_legacy_rows(rows, module=None, search=None)

    assert [row.id for row in filtered] == ["2"]
