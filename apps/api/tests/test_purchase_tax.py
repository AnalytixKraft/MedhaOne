from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.company_settings import CompanySettings
from app.models.party import Party
from app.models.role import Role
from app.models.user import User
from app.models.warehouse import Warehouse
from app.models.product import Product


def _create_access_user(db: Session) -> str:
    role = Role(name="admin", is_active=True)
    db.add(role)
    db.flush()

    user = User(
        email="purchase-tax-admin@medhaone.app",
        full_name="Purchase Tax Admin",
        hashed_password="not-used",
        is_active=True,
        is_superuser=True,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token(str(user.id))


def _seed_company_settings(db: Session, gst_number: str | None) -> None:
    settings = db.query(CompanySettings).filter(CompanySettings.id == 1).first()
    if settings is None:
        settings = CompanySettings(id=1)
        db.add(settings)
    settings.gst_number = gst_number
    db.commit()


def _seed_supplier(db: Session, *, gstin: str | None) -> int:
    supplier = Party(
        name=f"Supplier {gstin or 'No GST'}",
        party_type="DISTRIBUTOR",
        gstin=gstin,
        pan_number="ABCDE1234F" if gstin else None,
        state="Maharashtra" if gstin and gstin.startswith("27") else "Delhi",
        is_active=True,
    )
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier.id


def _seed_warehouse(db: Session) -> int:
    warehouse = Warehouse(name="Main Warehouse", code="PO-TAX-WH", is_active=True)
    db.add(warehouse)
    db.commit()
    db.refresh(warehouse)
    return warehouse.id


def _seed_product(db: Session) -> int:
    product = Product(
        sku="PO-TAX-SKU",
        name="PO Tax Product",
        brand="AK",
        uom="BOX",
        gst_rate=Decimal("12.00"),
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product.id


def _create_po(
    client: TestClient,
    headers: dict[str, str],
    *,
    supplier_id: int,
    warehouse_id: int,
    product_id: int,
) -> dict:
    response = client.post(
        "/purchase/po",
        headers=headers,
        json={
            "supplier_id": supplier_id,
            "warehouse_id": warehouse_id,
            "order_date": "2026-03-08",
            "discount_percent": "5.00",
            "adjustment": "0.00",
            "gst_percent": "12.00",
            "lines": [
                {
                    "product_id": product_id,
                    "ordered_qty": "10",
                    "unit_cost": "100.00",
                    "free_qty": "0",
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_purchase_order_same_state_splits_cgst_sgst(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    _seed_company_settings(db, "27AAAAA1111A1Z1")
    supplier_id = _seed_supplier(db, gstin="27ABCDE1234F1Z5")
    warehouse_id = _seed_warehouse(db)
    product_id = _seed_product(db)

    body = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
    )

    assert body["tax_type"] == "INTRA_STATE"
    assert body["subtotal"] == "1000.00"
    assert body["discount_amount"] == "50.00"
    assert body["taxable_value"] == "950.00"
    assert body["cgst_percent"] == "6.00"
    assert body["sgst_percent"] == "6.00"
    assert body["igst_percent"] == "0.00"
    assert body["cgst_amount"] == "57.00"
    assert body["sgst_amount"] == "57.00"
    assert body["igst_amount"] == "0.00"
    assert body["final_total"] == "1064.00"


def test_purchase_order_different_state_uses_igst(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    _seed_company_settings(db, "27AAAAA1111A1Z1")
    supplier_id = _seed_supplier(db, gstin="07ABCDE1234F1Z5")
    warehouse_id = _seed_warehouse(db)
    product_id = _seed_product(db)

    body = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
    )

    assert body["tax_type"] == "INTER_STATE"
    assert body["cgst_percent"] == "0.00"
    assert body["sgst_percent"] == "0.00"
    assert body["igst_percent"] == "12.00"
    assert body["cgst_amount"] == "0.00"
    assert body["sgst_amount"] == "0.00"
    assert body["igst_amount"] == "114.00"
    assert body["final_total"] == "1064.00"


def test_purchase_order_save_returns_structured_validation_error_for_missing_company_gstin(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    _seed_company_settings(db, None)
    supplier_id = _seed_supplier(db, gstin="27ABCDE1234F1Z5")
    warehouse_id = _seed_warehouse(db)
    product_id = _seed_product(db)

    response = client.post(
        "/purchase/po",
        headers=headers,
        json={
            "supplier_id": supplier_id,
            "warehouse_id": warehouse_id,
            "order_date": "2026-03-08",
            "discount_percent": "0.00",
            "adjustment": "0.00",
            "gst_percent": "12.00",
            "lines": [
                {
                    "product_id": product_id,
                    "ordered_qty": "10",
                    "unit_cost": "100.00",
                    "free_qty": "0",
                }
            ],
        },
    )

    assert response.status_code == 400, response.text
    body = response.json()
    assert body["error_code"] == "VALIDATION_ERROR"
    assert "Company GSTIN not configured" in body["message"]
    assert body["details"]["field"] == "company_gstin"
