from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token, get_password_hash
from app.models.company_settings import CompanySettings
from app.models.role import Role
from app.models.user import User


def _token_for_admin(db: Session, email: str = "po-workflow@medhaone.app") -> str:
    role = Role(name=f"admin-{email}", is_active=True)
    db.add(role)
    db.flush()
    user = User(
        email=email,
        full_name="PO Workflow Admin",
        hashed_password=get_password_hash("ChangeMe123!"),
        is_active=True,
        is_superuser=True,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token(str(user.id))


def _create_supplier(client: TestClient, headers: dict[str, str], name: str = "PO Workflow Supplier") -> int:
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "name": name,
            "party_type": "SUPPLIER",
            "party_category": "STOCKIST",
            "gstin": "27ABCDE1234F1Z5",
            "state": "Maharashtra",
            "phone": "9999999999",
            "is_active": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_warehouse(client: TestClient, headers: dict[str, str], code: str = "POWF01") -> int:
    response = client.post(
        "/masters/warehouses",
        headers=headers,
        json={"name": "PO Workflow Warehouse", "code": code, "is_active": True},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_product(client: TestClient, headers: dict[str, str], sku: str = "POWF-SKU-1") -> int:
    response = client.post(
        "/masters/products",
        headers=headers,
        json={"sku": sku, "name": "PO Workflow Product", "uom": "EA", "gst_rate": "12.00", "is_active": True},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _configure_company_settings(db: Session) -> None:
    settings = db.get(CompanySettings, 1)
    if settings is None:
        settings = CompanySettings(id=1)
        db.add(settings)
    settings.company_name = "PO Workflow Org"
    settings.gst_number = "27AKERP0516F1Z3"
    settings.state = "Maharashtra"
    db.commit()


def _create_po(
    client: TestClient,
    headers: dict[str, str],
    *,
    supplier_id: int,
    warehouse_id: int,
    product_id: int,
    qty: str = "5",
) -> dict:
    response = client.post(
        "/purchase/po",
        headers=headers,
        json={
            "supplier_id": supplier_id,
            "warehouse_id": warehouse_id,
            "order_date": "2026-03-09",
            "discount_percent": "0",
            "adjustment": "0",
            "gst_percent": "0",
            "lines": [{"product_id": product_id, "ordered_qty": qty, "unit_cost": "10.00"}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_purchase_order_draft_can_be_updated_and_listed(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers = {"Authorization": f"Bearer {_token_for_admin(db)}"}
    _configure_company_settings(db)

    supplier_id = _create_supplier(client, headers)
    warehouse_id = _create_warehouse(client, headers)
    product_id = _create_product(client, headers)
    purchase_order = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
    )

    update_response = client.patch(
        f"/purchase/po/{purchase_order['id']}",
        headers=headers,
        json={
            "supplier_id": supplier_id,
            "warehouse_id": warehouse_id,
            "order_date": "2026-03-09",
            "discount_percent": "0",
            "adjustment": "0",
            "gst_percent": "0",
            "lines": [{"product_id": product_id, "ordered_qty": "12", "unit_cost": "15.00"}],
        },
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["lines"][0]["ordered_qty"] == "12.000"

    list_response = client.get("/purchase/po?search=PO-", headers=headers)
    assert list_response.status_code == 200, list_response.text
    assert any(item["id"] == purchase_order["id"] for item in list_response.json()["items"])

    detail_response = client.get(f"/purchase/po/{purchase_order['id']}", headers=headers)
    assert detail_response.status_code == 200
    assert detail_response.json()["supplier_name"] == "PO Workflow Supplier"


def test_purchase_order_draft_can_be_cancelled(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers = {"Authorization": f"Bearer {_token_for_admin(db, 'po-cancel@medhaone.app')}"}
    _configure_company_settings(db)
    supplier_id = _create_supplier(client, headers, "Cancel Supplier")
    warehouse_id = _create_warehouse(client, headers, "POWF02")
    product_id = _create_product(client, headers, "POWF-SKU-2")
    purchase_order = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
    )

    cancel_response = client.post(f"/purchase/po/{purchase_order['id']}/cancel", headers=headers)
    assert cancel_response.status_code == 200, cancel_response.text
    assert cancel_response.json()["status"] == "CANCELLED"


def test_approved_purchase_order_cannot_be_edited(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers = {"Authorization": f"Bearer {_token_for_admin(db, 'po-approved@medhaone.app')}"}
    _configure_company_settings(db)
    supplier_id = _create_supplier(client, headers, "Approved Supplier")
    warehouse_id = _create_warehouse(client, headers, "POWF03")
    product_id = _create_product(client, headers, "POWF-SKU-3")
    purchase_order = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
    )

    approve_response = client.post(f"/purchase/po/{purchase_order['id']}/approve", headers=headers)
    assert approve_response.status_code == 200, approve_response.text

    update_response = client.patch(
        f"/purchase/po/{purchase_order['id']}",
        headers=headers,
        json={
            "supplier_id": supplier_id,
            "warehouse_id": warehouse_id,
            "order_date": "2026-03-09",
            "discount_percent": "0",
            "adjustment": "0",
            "gst_percent": "0",
            "lines": [{"product_id": product_id, "ordered_qty": "8", "unit_cost": "10.00"}],
        },
    )
    assert update_response.status_code == 409
    assert update_response.json()["error_code"] == "INVALID_STATE"
