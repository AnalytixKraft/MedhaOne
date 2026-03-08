from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.batch import Batch
from app.models.inventory import StockSummary
from app.models.role import Role
from app.models.user import User


def _create_access_user(db: Session) -> str:
    role = Role(name="admin", is_active=True)
    db.add(role)
    db.flush()

    user = User(
        email="smoke-admin@medhaone.app",
        full_name="Smoke Admin",
        hashed_password="not-used-in-token-smoke",
        is_active=True,
        is_superuser=True,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token(str(user.id))


def _get_stock_summary(
    db: Session,
    warehouse_id: int,
    product_id: int,
    batch_id: int,
) -> StockSummary:
    summary = (
        db.query(StockSummary)
        .filter(StockSummary.warehouse_id == warehouse_id)
        .filter(StockSummary.product_id == product_id)
        .filter(StockSummary.batch_id == batch_id)
        .first()
    )
    assert summary is not None
    return summary


def test_inventory_endpoints_smoke(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    product_resp = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "SMOKE-PAR-001",
            "name": "Paracetamol Smoke",
            "brand": "AK",
            "uom": "BOX",
            "is_active": True,
        },
    )
    assert product_resp.status_code == 201, product_resp.text
    product_id = product_resp.json()["id"]

    warehouse_resp = client.post(
        "/masters/warehouses",
        headers=headers,
        json={"name": "Smoke Main", "code": "SMKMAIN", "address": "Test Zone", "is_active": True},
    )
    assert warehouse_resp.status_code == 201, warehouse_resp.text
    warehouse_id = warehouse_resp.json()["id"]

    batch = Batch(
        product_id=product_id,
        batch_no="SMK-B1",
        expiry_date=date(2030, 12, 31),
        mfg_date=date(2026, 1, 1),
        mrp=Decimal("99.00"),
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    stock_in_resp = client.post(
        "/inventory/in",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch.id,
            "qty": "10",
            "reason": "PURCHASE_GRN",
        },
    )
    assert stock_in_resp.status_code == 200, stock_in_resp.text

    stock_out_resp = client.post(
        "/inventory/out",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch.id,
            "qty": "4",
            "reason": "SALES_DISPATCH",
        },
    )
    assert stock_out_resp.status_code == 200, stock_out_resp.text

    summary = _get_stock_summary(
        db,
        warehouse_id=warehouse_id,
        product_id=product_id,
        batch_id=batch.id,
    )
    assert Decimal(str(summary.qty_on_hand)) == Decimal("6")

    insufficient_resp = client.post(
        "/inventory/out",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch.id,
            "qty": "7",
            "reason": "SALES_DISPATCH",
        },
    )
    assert insufficient_resp.status_code == 400
    error_payload = insufficient_resp.json()
    assert error_payload["error_code"] == "INSUFFICIENT_STOCK"
    assert "Insufficient stock" in error_payload["message"]


def test_bulk_opening_stock_upload_mixed_rows(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    product_resp = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "SMOKE-OPEN-001",
            "name": "Opening Product",
            "brand": "AK",
            "uom": "BOX",
            "is_active": True,
        },
    )
    assert product_resp.status_code == 201, product_resp.text
    product_id = product_resp.json()["id"]

    warehouse_resp = client.post(
        "/masters/warehouses",
        headers=headers,
        json={
            "name": "Opening Warehouse",
            "code": "OPNMAIN",
            "address": "Test Zone",
            "is_active": True,
        },
    )
    assert warehouse_resp.status_code == 201, warehouse_resp.text
    warehouse_id = warehouse_resp.json()["id"]

    response = client.post(
        "/inventory/opening-stock/bulk",
        headers=headers,
        json={
            "rows": [
                {
                    "sku": "SMOKE-OPEN-001",
                    "warehouse_code": "OPNMAIN",
                    "batch_no": "OPEN-B1",
                    "expiry_date": "2032-12-31",
                    "qty": "12",
                },
                {
                    "sku": "MISSING-SKU",
                    "warehouse_code": "OPNMAIN",
                    "batch_no": "OPEN-B2",
                    "expiry_date": "2032-12-31",
                    "qty": "5",
                },
                {
                    "sku": "SMOKE-OPEN-001",
                    "warehouse_code": "BAD-WH",
                    "batch_no": "OPEN-B3",
                    "expiry_date": "2032-12-31",
                    "qty": "5",
                },
            ]
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    assert body["failed_count"] == 2
    assert any(error["field"] == "sku" for error in body["errors"])
    assert any(error["field"] == "warehouse_code" for error in body["errors"])

    batch = (
        db.query(Batch)
        .filter(Batch.product_id == product_id)
        .filter(Batch.batch_no == "OPEN-B1")
        .first()
    )
    assert batch is not None

    summary = _get_stock_summary(
        db,
        warehouse_id=warehouse_id,
        product_id=product_id,
        batch_id=batch.id,
    )
    assert Decimal(str(summary.qty_on_hand)) == Decimal("12")


def test_opening_stock_template_available(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    response = client.get("/inventory/templates/opening-stock-import.csv", headers=headers)

    assert response.status_code == 200, response.text
    assert "text/csv" in response.headers.get("content-type", "")
    assert "sku,warehouse_code,batch_no,expiry_date,qty,mfg_date,mrp,ref_id" in response.text
