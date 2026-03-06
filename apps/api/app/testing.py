from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.batch import Batch
from app.models.enums import PartyType
from app.models.role import Role
from app.models.user import User


def create_superuser_headers(db: Session, email: str) -> tuple[dict[str, str], User]:
    role = Role(name=f"role-{email}", is_active=True)
    db.add(role)
    db.flush()

    user = User(
        email=email,
        full_name=email.split("@")[0].replace(".", " ").title(),
        hashed_password="not-used",
        is_active=True,
        is_superuser=True,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(str(user.id))
    return {"Authorization": f"Bearer {token}"}, user


def create_restricted_headers(db: Session, email: str) -> dict[str, str]:
    role = Role(name=f"restricted-{email}", is_active=True)
    db.add(role)
    db.flush()

    user = User(
        email=email,
        full_name="Restricted User",
        hashed_password="not-used",
        is_active=True,
        is_superuser=False,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(str(user.id))
    return {"Authorization": f"Bearer {token}"}


def create_supplier(client: TestClient, headers: dict[str, str], name: str) -> int:
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "name": name,
            "party_type": PartyType.SUPER_STOCKIST.value,
            "phone": "9999999999",
            "is_active": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def create_warehouse(client: TestClient, headers: dict[str, str], code: str) -> int:
    response = client.post(
        "/masters/warehouses",
        headers=headers,
        json={"name": f"Warehouse {code}", "code": code, "is_active": True},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def create_product(client: TestClient, headers: dict[str, str], sku: str) -> int:
    response = client.post(
        "/masters/products",
        headers=headers,
        json={"sku": sku, "name": f"Product {sku}", "brand": "AK", "uom": "BOX", "is_active": True},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def create_batch(db: Session, *, product_id: int, batch_no: str, expiry_date: date) -> Batch:
    batch = Batch(
        product_id=product_id,
        batch_no=batch_no,
        expiry_date=expiry_date,
        mrp=Decimal("100.00"),
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch


def create_po(
    client: TestClient,
    headers: dict[str, str],
    *,
    supplier_id: int,
    warehouse_id: int,
    product_id: int,
    ordered_qty: str,
    unit_cost: str,
    order_date: str,
) -> dict:
    response = client.post(
        "/purchase/po",
        headers=headers,
        json={
            "supplier_id": supplier_id,
            "warehouse_id": warehouse_id,
            "order_date": order_date,
            "lines": [
                {
                    "product_id": product_id,
                    "ordered_qty": ordered_qty,
                    "unit_cost": unit_cost,
                    "free_qty": "0",
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def approve_po(client: TestClient, headers: dict[str, str], po_id: int) -> dict:
    response = client.post(f"/purchase/po/{po_id}/approve", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def create_and_post_grn(
    client: TestClient,
    headers: dict[str, str],
    *,
    po_id: int,
    po_line_id: int,
    received_qty: str,
    batch_no: str,
    expiry_date: str,
    received_date: str,
    free_qty: str = "0",
) -> dict:
    create_response = client.post(
        f"/purchase/grn/from-po/{po_id}",
        headers=headers,
        json={
            "received_date": received_date,
            "lines": [
                {
                    "po_line_id": po_line_id,
                    "received_qty": received_qty,
                    "free_qty": free_qty,
                    "batch_no": batch_no,
                    "expiry_date": expiry_date,
                }
            ],
        },
    )
    assert create_response.status_code == 201, create_response.text
    grn = create_response.json()

    post_response = client.post(f"/purchase/grn/{grn['id']}/post", headers=headers)
    assert post_response.status_code == 200, post_response.text
    return post_response.json()
