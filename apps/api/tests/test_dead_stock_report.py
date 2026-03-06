from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.inventory import InventoryLedger
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


def test_dead_stock_is_flagged_after_threshold(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers, _ = create_superuser_headers(db, "dead-stock-admin@medhaone.app")

    supplier_id = create_supplier(client, headers, "Dead Stock Supplier")
    warehouse_id = create_warehouse(client, headers, "DSWH")
    product_id = create_product(client, headers, "DS-SKU-1")

    po = create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
        ordered_qty="6",
        unit_cost="14.00",
        order_date=date.today().isoformat(),
    )
    approve_po(client, headers, po["id"])

    grn = create_and_post_grn(
        client,
        headers,
        po_id=po["id"],
        po_line_id=po["lines"][0]["id"],
        received_qty="6",
        batch_no="DS-BATCH-1",
        expiry_date="2031-12-31",
        received_date=date.today().isoformat(),
    )

    stale_timestamp = datetime.now(timezone.utc) - timedelta(days=120)
    ledger_rows = (
        db.query(InventoryLedger)
        .filter(InventoryLedger.ref_type == "GRN")
        .filter(InventoryLedger.ref_id == grn["grn_number"])
        .all()
    )
    assert ledger_rows
    for ledger in ledger_rows:
        ledger.created_at = stale_timestamp
    db.commit()

    response = client.get(
        "/reports/dead-stock",
        headers=headers,
        params={"inactivity_days": 90},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    row = payload["data"][0]
    assert row["product"] == "Product DS-SKU-1"
    assert Decimal(str(row["current_qty"])) == Decimal("6")
    assert row["days_since_movement"] >= 120


def test_dead_stock_report_requires_permission(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers = create_restricted_headers(db, "dead-stock-denied@medhaone.app")

    response = client.get("/reports/dead-stock", headers=headers)

    assert response.status_code == 403
    assert response.json()["error_code"] == "FORBIDDEN"
