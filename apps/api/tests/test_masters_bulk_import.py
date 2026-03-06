from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token, get_password_hash
from app.models.tax_rate import TaxRate
from app.models.user import User
from app.services.rbac import assign_roles_to_user, ensure_rbac_seeded
from conftest import TEST_TENANT_SLUG


def _create_user(
    db: Session,
    *,
    email: str,
    role_names: list[str],
    password: str = "ChangeMe123!",
    is_active: bool = True,
    is_superuser: bool = False,
    organization_slug: str | None = TEST_TENANT_SLUG,
) -> User:
    roles_by_name = ensure_rbac_seeded(db)
    role_ids = [roles_by_name[name].id for name in role_names]
    user = User(
        email=email,
        full_name=email.split("@")[0].replace(".", " ").title(),
        hashed_password=get_password_hash(password),
        is_active=is_active,
        is_superuser=is_superuser,
        organization_slug=organization_slug,
        role_id=role_ids[0] if role_ids else None,
    )
    db.add(user)
    db.flush()
    assign_roles_to_user(db, user, role_ids)
    db.commit()
    db.refresh(user)
    return user


def _token_for(user: User) -> str:
    return create_access_token(str(user.id))


def _headers_for_admin(client_with_test_db: tuple[TestClient, Session]) -> tuple[TestClient, Session, dict[str, str]]:
    client, db = client_with_test_db
    admin = _create_user(db, email="masters-admin@medhaone.app", role_names=["ADMIN"])
    headers = {"Authorization": f"Bearer {_token_for(admin)}"}
    return client, db, headers


def test_party_gstin_extracts_pan(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "name": "GST Supplier",
            "party_type": "DISTRIBUTOR",
            "gstin": "27abcde1234f1z5",
            "is_active": True,
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["gstin"] == "27ABCDE1234F1Z5"
    assert body["pan_number"] == "ABCDE1234F"
    assert body["state"] == "Maharashtra"


def test_party_invalid_gstin_rejected(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "name": "Invalid GST",
            "party_type": "DISTRIBUTOR",
            "gstin": "INVALIDGST",
            "is_active": True,
        },
    )

    assert response.status_code == 400, response.text
    body = response.json()
    assert body["error_code"] == "VALIDATION_ERROR"
    assert body["message"] == "Invalid GSTIN format"


def test_bulk_party_import_mixed_rows(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)
    response = client.post(
        "/masters/parties/bulk",
        headers=headers,
        json={
            "rows": [
                {
                    "name": "ABC Traders",
                    "type": "DISTRIBUTOR",
                    "gstin": "27ABCDE1234F1Z5",
                    "phone": "9876543210",
                    "city": "Pune",
                    "pincode": "411045",
                },
                {
                    "name": "Invalid GST Row",
                    "party_type": "DISTRIBUTOR",
                    "gstin": "123",
                },
                {
                    "name": "Manual PAN Party",
                    "party_type": "PHARMACY",
                    "pan_number": "AAAPL1234C",
                },
            ]
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 2
    assert body["failed_count"] == 1
    assert body["errors"][0]["field"] == "gstin"


def test_party_state_override_respected_when_gstin_present(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "name": "Override State Party",
            "party_type": "DISTRIBUTOR",
            "gstin": "27ABCDE1234F1Z5",
            "state": "Custom State",
            "is_active": True,
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["pan_number"] == "ABCDE1234F"
    assert body["state"] == "Custom State"


def test_bulk_item_import_mixed_rows(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(
        TaxRate(
            code="GST_5",
            label="GST 5%",
            rate_percent="5.00",
            is_active=True,
        )
    )
    db.commit()

    response = client.post(
        "/masters/items/bulk",
        headers=headers,
        json={
            "rows": [
                {
                    "sku": "SKU001",
                    "name": "Paracetamol 500",
                    "uom": "PCS",
                    "gst_rate": "5",
                },
                {
                    "sku": "SKU002",
                    "name": "Unknown Tax Rate",
                    "uom": "PCS",
                    "gst_rate": "18",
                },
                {
                    "sku": "SKU001",
                    "name": "Duplicate SKU",
                    "uom": "PCS",
                    "gst_rate": "5",
                },
            ]
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    assert body["failed_count"] == 2
    assert any(error["field"] == "gst_rate" for error in body["errors"])
    assert any(error["field"] == "sku" for error in body["errors"])


def test_import_templates_available(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)

    party_template = client.get("/masters/templates/party-import.csv", headers=headers)
    assert party_template.status_code == 200, party_template.text
    assert "text/csv" in party_template.headers.get("content-type", "")
    assert "name,party_type,gstin,phone,email,address,state,city,pincode" in party_template.text

    item_template = client.get("/masters/templates/item-import.csv", headers=headers)
    assert item_template.status_code == 200, item_template.text
    assert "text/csv" in item_template.headers.get("content-type", "")
    assert "sku,name,uom,price,gst_rate" in item_template.text
