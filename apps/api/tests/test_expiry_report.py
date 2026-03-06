from datetime import date, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

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


def test_expired_batch_is_reported_when_include_expired_is_enabled(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers, _ = create_superuser_headers(db, "expiry-admin@medhaone.app")

    supplier_id = create_supplier(client, headers, "Expiry Supplier")
    warehouse_id = create_warehouse(client, headers, "EXPWH")
    product_id = create_product(client, headers, "EXP-SKU-1")

    po = create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
        ordered_qty="5",
        unit_cost="20.00",
        order_date=date.today().isoformat(),
    )
    approve_po(client, headers, po["id"])

    expired_date = (date.today() - timedelta(days=5)).isoformat()
    create_and_post_grn(
        client,
        headers,
        po_id=po["id"],
        po_line_id=po["lines"][0]["id"],
        received_qty="5",
        batch_no="EXP-BATCH-1",
        expiry_date=expired_date,
        received_date=date.today().isoformat(),
    )

    response = client.get(
        "/reports/expiry",
        headers=headers,
        params={"include_expired": "true", "expiry_within_days": 30},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    row = payload["data"][0]
    assert row["product"] == "Product EXP-SKU-1"
    assert row["batch"] == "EXP-BATCH-1"
    assert Decimal(str(row["current_qty"])) == Decimal("5")
    assert row["days_to_expiry"] == -5


def test_expiry_report_requires_permission(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers = create_restricted_headers(db, "expiry-denied@medhaone.app")

    response = client.get("/reports/expiry", headers=headers)

    assert response.status_code == 403
    assert response.json()["error_code"] == "FORBIDDEN"
