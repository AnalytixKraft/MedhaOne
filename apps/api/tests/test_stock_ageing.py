from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.purchase import GRN
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


def test_stock_ageing_buckets_sum_to_total_with_partial_depletion(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers, _ = create_superuser_headers(db, "ageing-admin@medhaone.app")

    supplier_id = create_supplier(client, headers, "Ageing Supplier")
    warehouse_id = create_warehouse(client, headers, "AGEWH")
    product_id = create_product(client, headers, "AGE-SKU-1")

    first_po = create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
        ordered_qty="10",
        unit_cost="11.00",
        order_date=date.today().isoformat(),
    )
    approve_po(client, headers, first_po["id"])
    first_grn = create_and_post_grn(
        client,
        headers,
        po_id=first_po["id"],
        po_line_id=first_po["lines"][0]["id"],
        received_qty="10",
        batch_no="AGE-BATCH-1",
        expiry_date="2032-12-31",
        received_date=date.today().isoformat(),
    )

    second_po = create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
        ordered_qty="10",
        unit_cost="11.00",
        order_date=date.today().isoformat(),
    )
    approve_po(client, headers, second_po["id"])
    second_grn = create_and_post_grn(
        client,
        headers,
        po_id=second_po["id"],
        po_line_id=second_po["lines"][0]["id"],
        received_qty="10",
        batch_no="AGE-BATCH-1",
        expiry_date="2032-12-31",
        received_date=date.today().isoformat(),
    )

    first_record = db.query(GRN).filter(GRN.id == first_grn["id"]).one()
    second_record = db.query(GRN).filter(GRN.id == second_grn["id"]).one()
    first_record.posted_at = datetime.now(timezone.utc) - timedelta(days=100)
    second_record.posted_at = datetime.now(timezone.utc) - timedelta(days=20)
    db.commit()

    adjust_response = client.post(
        "/inventory/adjust",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": first_grn["lines"][0]["batch_id"],
            "delta_qty": "-8",
            "reason": "STOCK_ADJUSTMENT",
        },
    )
    assert adjust_response.status_code == 200, adjust_response.text

    response = client.get("/reports/stock-ageing", headers=headers)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    row = payload["data"][0]
    assert Decimal(str(row["bucket_0_30"])) == Decimal("10")
    assert Decimal(str(row["bucket_90_plus"])) == Decimal("2")
    assert Decimal(str(row["bucket_31_60"])) == Decimal("0")
    assert Decimal(str(row["bucket_61_90"])) == Decimal("0")
    total = (
        Decimal(str(row["bucket_0_30"]))
        + Decimal(str(row["bucket_31_60"]))
        + Decimal(str(row["bucket_61_90"]))
        + Decimal(str(row["bucket_90_plus"]))
    )
    assert total == Decimal(str(row["total_qty"])) == Decimal("12")


def test_stock_ageing_report_requires_permission(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers = create_restricted_headers(db, "ageing-denied@medhaone.app")

    response = client.get("/reports/stock-ageing", headers=headers)

    assert response.status_code == 403
    assert response.json()["error_code"] == "FORBIDDEN"
