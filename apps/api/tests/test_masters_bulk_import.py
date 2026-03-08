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
            "party_name": "GST Supplier",
            "party_type": "DISTRIBUTOR",
            "gstin": "27abcde1234f1z5",
            "is_active": True,
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["party_name"] == "GST Supplier"
    assert body["name"] == "GST Supplier"
    assert body["party_type"] == "SUPPLIER"
    assert body["party_category"] == "DISTRIBUTOR"
    assert body["gstin"] == "27ABCDE1234F1Z5"
    assert body["pan_number"] == "ABCDE1234F"
    assert body["state"] == "Maharashtra"


def test_party_invalid_gstin_rejected(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Invalid GST",
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
                    "party_name": "ABC Traders",
                    "type": "DISTRIBUTOR",
                    "gstin": "27ABCDE1234F1Z5",
                    "mobile": "9876543210",
                    "city": "Pune",
                    "pincode": "411045",
                },
                {
                    "party_name": "Invalid GST Row",
                    "party_type": "DISTRIBUTOR",
                    "gstin": "123",
                },
                {
                    "party_name": "Manual PAN Party",
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
            "party_name": "Override State Party",
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
    assert (
        "party_name,party_type,party_category,contact_person,mobile,email,address_line_1,city,state,pincode,gstin,drug_license_number,fssai_number,udyam_number,credit_limit,payment_terms"
        in party_template.text
    )

    direct_template = client.get("/masters/parties/template.csv", headers=headers)
    assert direct_template.status_code == 200, direct_template.text
    assert "text/csv" in direct_template.headers.get("content-type", "")
    assert "party_name,party_type,party_category" in direct_template.text

    item_template = client.get("/masters/templates/item-import.csv", headers=headers)
    assert item_template.status_code == 200, item_template.text
    assert "text/csv" in item_template.headers.get("content-type", "")
    assert "sku,name,uom,price,gst_rate" in item_template.text


def test_party_duplicate_gstin_rejected(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)
    first_response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "First Supplier",
            "party_type": "SUPPLIER",
            "party_category": "DISTRIBUTOR",
            "gstin": "27ABCDE1234F1Z5",
            "is_active": True,
        },
    )
    assert first_response.status_code == 201, first_response.text

    duplicate_response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Duplicate Supplier",
            "party_type": "SUPPLIER",
            "party_category": "DISTRIBUTOR",
            "gstin": "27ABCDE1234F1Z5",
            "is_active": True,
        },
    )
    assert duplicate_response.status_code == 400, duplicate_response.text
    assert duplicate_response.json()["details"]["field"] == "gstin"


def test_party_advanced_fields_persist(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Compliance Rich Party",
            "display_name": "Compliance Rich",
            "party_code": "PTY-001",
            "party_type": "BOTH",
            "party_category": "PHARMACY",
            "contact_person": "Lijo",
            "designation": "Owner",
            "mobile": "9876543210",
            "whatsapp_no": "9876543210",
            "office_phone": "020400500",
            "email": "party@example.com",
            "website": "https://example.com",
            "address_line_1": "Line 1",
            "address_line_2": "Line 2",
            "city": "Pune",
            "state": "Maharashtra",
            "pincode": "411045",
            "country": "India",
            "registration_type": "REGISTERED",
            "drug_license_number": "DL-123",
            "fssai_number": "FSSAI-123",
            "udyam_number": "UDYAM-123",
            "credit_limit": "125000.00",
            "payment_terms": "30 days",
            "opening_balance": "1500.00",
            "outstanding_tracking_mode": "FIFO",
            "is_active": True,
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["party_code"] == "PTY-001"
    assert body["contact_person"] == "Lijo"
    assert body["drug_license_number"] == "DL-123"
    assert body["fssai_number"] == "FSSAI-123"
    assert body["udyam_number"] == "UDYAM-123"
    assert body["credit_limit"] == "125000.00"
    assert body["opening_balance"] == "1500.00"
    assert body["outstanding_tracking_mode"] == "FIFO"
