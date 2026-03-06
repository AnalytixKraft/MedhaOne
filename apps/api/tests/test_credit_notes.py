from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.purchase import PurchaseCreditNote
from app.services.purchase import create_purchase_return, post_purchase_return
from app.testing import (
    create_batch,
    create_product,
    create_restricted_headers,
    create_superuser_headers,
    create_supplier,
    create_warehouse,
)


def test_credit_note_is_auto_generated_after_purchase_return_post(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers, user = create_superuser_headers(db, "credit-note-admin@medhaone.app")

    supplier_id = create_supplier(client, headers, "Credit Supplier")
    warehouse_id = create_warehouse(client, headers, "CRDWH")
    product_id = create_product(client, headers, "CRD-SKU-1")
    batch = create_batch(
        db,
        product_id=product_id,
        batch_no="CRD-BATCH-1",
        expiry_date=date(2031, 12, 31),
    )

    purchase_return = create_purchase_return(
        db,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[
            {
                "product_id": product_id,
                "batch_id": batch.id,
                "quantity": "3",
                "unit_cost": "12.50",
            }
        ],
        created_by=user.id,
    )

    posted = post_purchase_return(db, purchase_return.id, user.id)
    credit_note = (
        db.query(PurchaseCreditNote)
        .filter(PurchaseCreditNote.purchase_return_id == purchase_return.id)
        .one()
    )

    assert posted.credit_note is not None
    assert credit_note.credit_note_number.startswith("PCN-")
    assert Decimal(str(credit_note.total_amount)) == Decimal("37.5000")
    assert credit_note.status.value == "GENERATED"

    list_response = client.get("/purchase-credit-notes", headers=headers)
    assert list_response.status_code == 200, list_response.text
    assert len(list_response.json()) == 1

    detail_response = client.get(f"/purchase-credit-notes/{credit_note.id}", headers=headers)
    assert detail_response.status_code == 200, detail_response.text
    assert detail_response.json()["purchase_return_id"] == purchase_return.id


def test_purchase_credit_notes_require_permission(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers = create_restricted_headers(db, "credit-note-denied@medhaone.app")

    response = client.get("/purchase-credit-notes", headers=headers)

    assert response.status_code == 403
    assert response.json()["error_code"] == "FORBIDDEN"
