from decimal import Decimal

from conftest import TEST_TENANT_SLUG
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token, get_password_hash
from app.models.batch import Batch
from app.models.brand import Brand
from app.models.enums import PurchaseBillExtractionStatus, PurchaseBillStatus
from app.models.party import Party
from app.models.product import Product
from app.models.purchase_bill import PurchaseBill
from app.models.tax_rate import TaxRate
from app.models.user import User
from app.models.warehouse import Rack, Warehouse
from app.services.rbac import assign_roles_to_user, ensure_rbac_seeded
from app.testing import verify_gstin


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
            "gst_verification_log_id": verify_gstin(client, headers, "27abcde1234f1z5"),
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
    assert body["party_code"].startswith("PTY-")


def test_party_code_is_auto_generated_and_not_editable(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)
    create_response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Auto Code Party",
            "party_type": "SUPPLIER",
            "party_category": "DISTRIBUTOR",
            "gstin": "27ABCDE1234F1Z5",
            "gst_verification_log_id": verify_gstin(client, headers, "27ABCDE1234F1Z5"),
            "party_code": "MANUAL-CODE",
            "is_active": True,
        },
    )

    assert create_response.status_code == 201, create_response.text
    created_party = create_response.json()
    assert created_party["party_code"].startswith("PTY-")
    assert created_party["party_code"] != "MANUAL-CODE"

    update_response = client.patch(
        f"/masters/parties/{created_party['id']}",
        headers=headers,
        json={"party_code": "UPDATED-CODE", "display_name": "Updated"},
    )

    assert update_response.status_code == 200, update_response.text
    updated_party = update_response.json()
    assert updated_party["display_name"] == "Updated"
    assert updated_party["party_code"] == created_party["party_code"]


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


def test_party_missing_gstin_rejected(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Missing GST Party",
            "party_type": "SUPPLIER",
            "party_category": "DISTRIBUTOR",
            "is_active": True,
        },
    )

    assert response.status_code == 400, response.text
    body = response.json()
    assert body["error_code"] == "VALIDATION_ERROR"
    assert body["message"] == "GSTIN is required for non-retailer parties"
    assert body["details"]["field"] == "gstin"


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
    assert body["created_count"] == 1
    assert body["failed_count"] == 2
    assert all(error["field"] == "gstin" for error in body["errors"])


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
            "gst_verification_log_id": verify_gstin(client, headers, "27ABCDE1234F1Z5"),
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
    db.add(Brand(name="Medha", is_active=True))
    db.commit()

    response = client.post(
        "/masters/items/bulk",
        headers=headers,
        json={
            "rows": [
                {
                    "sku": "SKU001",
                    "product_name": "Paracetamol 500",
                    "manufacturer": "Medha",
                    "uom": "PCS",
                    "gst_rate": "5",
                },
                {
                    "sku": "SKU002",
                    "product_name": "Unknown Tax Rate",
                    "manufacturer": "Medha",
                    "uom": "PCS",
                    "gst_rate": "18",
                },
                {
                    "sku": "SKU001",
                    "product_name": "Duplicate SKU",
                    "manufacturer": "Medha",
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


def test_product_creation_supports_storage_defaults_and_decimal_behavior(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)

    brand_response = client.post(
        "/masters/brands",
        headers=headers,
        json={"name": "Ops Brand", "is_active": True},
    )
    assert brand_response.status_code in {201, 400}, brand_response.text

    tax_response = client.post(
        "/tax-rates",
        headers=headers,
        json={"code": "GST_18", "label": "GST 18%", "rate_percent": 18, "is_active": True},
    )
    assert tax_response.status_code in {201, 400}, tax_response.text

    warehouse_response = client.post(
        "/masters/warehouses",
        headers=headers,
        json={"name": "Ops Warehouse", "code": "OPSWH1", "address": "Pune", "is_active": True},
    )
    assert warehouse_response.status_code == 201, warehouse_response.text
    warehouse_id = warehouse_response.json()["id"]

    rack_response = client.post(
        "/masters/racks",
        headers=headers,
        json={"warehouse_id": warehouse_id, "rack_number": "R-12", "is_active": True},
    )
    assert rack_response.status_code == 201, rack_response.text

    create_response = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "OPS-SKU-001",
            "name": "Ops Product",
            "display_name": "Ops Product Display",
            "brand": "Ops Brand",
            "category": "Critical Care",
            "uom": "KG",
            "hsn": "30049099",
            "gst_rate": "18.00",
            "default_warehouse_id": warehouse_id,
            "rack_number": "R-12",
            "default_purchase_rate": "25.50",
            "default_sale_rate": "31.75",
            "mrp": "36.00",
            "decimal_allowed": True,
            "is_active": True,
        },
    )

    assert create_response.status_code == 201, create_response.text
    body = create_response.json()
    assert body["display_name"] == "Ops Product Display"
    assert body["category"] == "Critical Care"
    assert body["default_warehouse_id"] == warehouse_id
    assert body["default_warehouse_name"] == "Ops Warehouse"
    assert body["rack_number"] == "R-12"
    assert body["decimal_allowed"] is True
    assert body["quantity_precision"] == 3
    assert body["default_purchase_rate"] == "25.50"
    assert body["default_sale_rate"] == "31.75"
    assert body["mrp"] == "36.00"

    list_response = client.get("/masters/products", headers=headers)
    assert list_response.status_code == 200, list_response.text
    listed_product = next(item for item in list_response.json() if item["sku"] == "OPS-SKU-001")
    assert listed_product["default_warehouse_name"] == "Ops Warehouse"
    assert listed_product["rack_number"] == "R-12"


def test_category_crud_flow(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)

    create_response = client.post(
        "/masters/categories",
        headers=headers,
        json={"name": "Antibiotics", "is_active": True},
    )
    assert create_response.status_code == 201, create_response.text
    category = create_response.json()
    assert category["name"] == "Antibiotics"

    list_response = client.get("/masters/categories?include_inactive=true", headers=headers)
    assert list_response.status_code == 200, list_response.text
    assert any(item["name"] == "Antibiotics" for item in list_response.json())

    update_response = client.patch(
        f"/masters/categories/{category['id']}",
        headers=headers,
        json={"name": "General Medicines"},
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["name"] == "General Medicines"

    delete_response = client.delete(
        f"/masters/categories/{category['id']}",
        headers=headers,
    )
    assert delete_response.status_code == 200, delete_response.text
    assert delete_response.json()["name"] == "General Medicines"


def test_duplicate_category_rejected(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)

    first_response = client.post(
        "/masters/categories",
        headers=headers,
        json={"name": "OTC"},
    )
    assert first_response.status_code == 201, first_response.text

    duplicate_response = client.post(
        "/masters/categories",
        headers=headers,
        json={"name": "otc"},
    )
    assert duplicate_response.status_code == 400, duplicate_response.text
    assert duplicate_response.json()["message"] == "Category already exists"


def test_party_category_cannot_be_disabled_when_active_party_exists(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)

    category_response = client.post(
        "/masters/categories",
        headers=headers,
        json={"name": "CHANNEL_PARTNER", "is_active": True},
    )
    assert category_response.status_code == 201, category_response.text
    category = category_response.json()

    party_response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Channel Partner One",
            "party_type": "BOTH",
            "party_category": "CHANNEL_PARTNER",
            "gstin": "27ABCDE1234F1Z5",
            "gst_verification_log_id": verify_gstin(client, headers, "27ABCDE1234F1Z5"),
            "is_active": True,
        },
    )
    assert party_response.status_code == 201, party_response.text

    update_response = client.patch(
        f"/masters/categories/{category['id']}",
        headers=headers,
        json={"is_active": False},
    )
    assert update_response.status_code == 400, update_response.text
    assert update_response.json()["message"] == "Party Category cannot be disabled while active parties are assigned to it."


def test_party_category_cannot_be_deleted_when_active_party_exists(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)

    category_response = client.post(
        "/masters/categories",
        headers=headers,
        json={"name": "KEY_ACCOUNT", "is_active": True},
    )
    assert category_response.status_code == 201, category_response.text
    category = category_response.json()

    party_response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Key Account Hospital",
            "party_type": "CUSTOMER",
            "party_category": "KEY_ACCOUNT",
            "gstin": "29ABCDE1234F1Z5",
            "gst_verification_log_id": verify_gstin(client, headers, "29ABCDE1234F1Z5"),
            "is_active": True,
        },
    )
    assert party_response.status_code == 201, party_response.text

    delete_response = client.delete(f"/masters/categories/{category['id']}", headers=headers)
    assert delete_response.status_code == 400, delete_response.text
    assert delete_response.json()["message"] == "Party Category cannot be deleted while active parties are assigned to it."


def test_party_category_rename_updates_existing_parties(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)

    category_response = client.post(
        "/masters/categories",
        headers=headers,
        json={"name": "TRADE_PARTNER", "is_active": True},
    )
    assert category_response.status_code == 201, category_response.text
    category = category_response.json()

    party_response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Trade Partner South",
            "party_type": "SUPPLIER",
            "party_category": "TRADE_PARTNER",
            "gstin": "33ABCDE1234F1Z5",
            "gst_verification_log_id": verify_gstin(client, headers, "33ABCDE1234F1Z5"),
            "is_active": False,
        },
    )
    assert party_response.status_code == 201, party_response.text
    party = party_response.json()

    rename_response = client.patch(
        f"/masters/categories/{category['id']}",
        headers=headers,
        json={"name": "CHANNEL_PARTNER_RENAMED"},
    )
    assert rename_response.status_code == 200, rename_response.text
    assert rename_response.json()["name"] == "CHANNEL_PARTNER_RENAMED"

    updated_party_response = client.get(f"/masters/parties/{party['id']}", headers=headers)
    assert updated_party_response.status_code == 200, updated_party_response.text
    assert updated_party_response.json()["party_category"] == "CHANNEL_PARTNER_RENAMED"


def test_category_list_includes_existing_party_categories(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(
        Party(
            name="Legacy Party Category Record",
            party_type="BOTH",
            party_category="CLINIC",
            gstin="27ABCDE1234F1Z5",
            is_active=True,
        )
    )
    db.commit()

    list_response = client.get("/masters/categories?include_inactive=true", headers=headers)
    assert list_response.status_code == 200, list_response.text
    assert any(item["name"] == "CLINIC" for item in list_response.json())


def test_brand_list_includes_existing_product_brands(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(
        Product(
            sku="LEGACY-BRAND-001",
            name="Legacy Brand Product",
            brand="Legacy Brand",
            uom="EA",
            quantity_precision=0,
            is_active=True,
        )
    )
    db.commit()

    list_response = client.get("/masters/brands?include_inactive=true", headers=headers)
    assert list_response.status_code == 200, list_response.text
    assert any(item["name"] == "Legacy Brand" for item in list_response.json())


def test_brand_crud_flow(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)

    create_response = client.post(
        "/masters/brands",
        headers=headers,
        json={"name": "Medha"},
    )
    assert create_response.status_code == 201, create_response.text
    brand = create_response.json()
    assert brand["name"] == "Medha"

    list_response = client.get("/masters/brands?include_inactive=true", headers=headers)
    assert list_response.status_code == 200, list_response.text
    assert any(item["name"] == "Medha" for item in list_response.json())

    update_response = client.patch(
        f"/masters/brands/{brand['id']}",
        headers=headers,
        json={"name": "Medha Plus"},
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["name"] == "Medha Plus"

    delete_response = client.delete(f"/masters/brands/{brand['id']}", headers=headers)
    assert delete_response.status_code == 200, delete_response.text
    assert delete_response.json()["name"] == "Medha Plus"


def test_product_requires_existing_brand(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(TaxRate(code="GST_12", label="GST 12%", rate_percent="12.00", is_active=True))
    db.commit()

    missing_brand_response = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "SKU-BRAND-001",
            "name": "Brand Locked Item",
            "brand": "Unknown Brand",
            "uom": "BOX",
            "gst_rate": "12.00",
        },
    )
    assert missing_brand_response.status_code == 400, missing_brand_response.text
    assert missing_brand_response.json()["message"] == "Manufacturer must exist in Master Settings and be active"

    db.add(Brand(name="Known Brand", is_active=True))
    db.commit()

    create_response = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "SKU-BRAND-002",
            "name": "Brand Valid Item",
            "brand": "Known Brand",
            "uom": "BOX",
            "gst_rate": "12.00",
        },
    )
    assert create_response.status_code == 201, create_response.text
    assert create_response.json()["brand"] == "Known Brand"


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
    assert "sku,product_name,display_name,manufacturer,category,uom,gst_rate,hsn,default_warehouse_code" in item_template.text


def test_bulk_item_import_accepts_current_product_fields(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    warehouse = Warehouse(name="Main Warehouse", code="MAINWH", address="Pune", is_active=True)
    db.add(TaxRate(code="GST_12", label="GST 12%", rate_percent="12.00", is_active=True))
    db.add(Brand(name="Medha Pharma", is_active=True))
    db.add(warehouse)
    db.flush()
    db.add(Rack(warehouse_id=warehouse.id, rack_number="R-01", is_active=True))
    db.commit()

    response = client.post(
        "/masters/items/bulk",
        headers=headers,
        json={
            "rows": [
                {
                    "sku": "SKU-CURRENT-001",
                    "product_name": "Current Product",
                    "display_name": "Current Product Display",
                    "manufacturer": "Medha Pharma",
                    "category": "General Medicines",
                    "uom": "BOX",
                    "gst_rate": "12.00",
                    "hsn": "30049099",
                    "default_warehouse_code": "MAINWH",
                    "rack_number": "R-01",
                    "decimal_allowed": "yes",
                    "default_purchase_rate": "25.50",
                    "default_sale_rate": "30.25",
                    "mrp": "36.00",
                    "is_active": "yes",
                }
            ]
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created_count"] == 1
    assert body["failed_count"] == 0

    product = db.query(Product).filter(Product.sku == "SKU-CURRENT-001").one()
    assert product.name == "Current Product"
    assert product.display_name == "Current Product Display"
    assert product.brand == "Medha Pharma"
    assert product.default_warehouse is not None
    assert product.default_warehouse.code == "MAINWH"
    assert product.rack_number == "R-01"
    assert product.default_purchase_rate == Decimal("25.50")
    assert product.default_sale_rate == Decimal("30.25")
    assert product.mrp == Decimal("36.00")
    assert product.decimal_allowed is True


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
            "gst_verification_log_id": verify_gstin(client, headers, "27ABCDE1234F1Z5"),
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


def test_delete_warehouse_hard_deletes_when_unused(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    create_response = client.post(
        "/masters/warehouses",
        headers=headers,
        json={
            "name": "Unused Warehouse",
            "code": "UNUSED01",
            "address": "Pune",
            "is_active": True,
        },
    )
    assert create_response.status_code == 201, create_response.text
    warehouse_id = create_response.json()["id"]

    delete_response = client.delete(f"/masters/warehouses/{warehouse_id}", headers=headers)

    assert delete_response.status_code == 200, delete_response.text
    body = delete_response.json()
    assert body["action"] == "deleted"
    assert body["warehouse"]["id"] == warehouse_id
    assert db.get(Warehouse, warehouse_id) is None


def test_delete_warehouse_deactivates_when_referenced(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    admin = db.query(User).filter(User.email == "masters-admin@medhaone.app").one()

    warehouse = Warehouse(name="Referenced Warehouse", code="REFWH01", is_active=True)
    db.add(warehouse)
    db.flush()
    db.add(
        PurchaseBill(
            bill_number="PB-REF-001",
            supplier_name_raw="Pending Supplier",
            warehouse_id=warehouse.id,
            status=PurchaseBillStatus.DRAFT,
            subtotal="0.00",
            discount_amount="0.00",
            taxable_value="0.00",
            cgst_amount="0.00",
            sgst_amount="0.00",
            igst_amount="0.00",
            adjustment="0.00",
            total="0.00",
            extraction_status=PurchaseBillExtractionStatus.NOT_STARTED,
            created_by=admin.id,
        )
    )
    db.commit()

    delete_response = client.delete(f"/masters/warehouses/{warehouse.id}", headers=headers)

    assert delete_response.status_code == 200, delete_response.text
    body = delete_response.json()
    assert body["action"] == "deactivated"
    assert "deactivated instead of deleted" in body["message"]
    db.refresh(warehouse)
    assert warehouse.is_active is False


def test_bulk_delete_warehouses_returns_mixed_results(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    admin = db.query(User).filter(User.email == "masters-admin@medhaone.app").one()

    removable = Warehouse(name="Removable Warehouse", code="BULKRM1", is_active=True)
    referenced = Warehouse(name="Referenced Bulk Warehouse", code="BULKRF1", is_active=True)
    db.add_all([removable, referenced])
    db.flush()
    db.add(
        PurchaseBill(
            bill_number="PB-BULK-001",
            supplier_name_raw="Pending Supplier",
            warehouse_id=referenced.id,
            status=PurchaseBillStatus.DRAFT,
            subtotal="0.00",
            discount_amount="0.00",
            taxable_value="0.00",
            cgst_amount="0.00",
            sgst_amount="0.00",
            igst_amount="0.00",
            adjustment="0.00",
            total="0.00",
            extraction_status=PurchaseBillExtractionStatus.NOT_STARTED,
            created_by=admin.id,
        )
    )
    db.commit()

    response = client.post(
        "/masters/warehouses/bulk-delete",
        headers=headers,
        json={"ids": [removable.id, referenced.id, 999999]},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["deleted_count"] == 1
    assert body["deactivated_count"] == 1
    assert body["failed_count"] == 1
    assert any(error["id"] == 999999 for error in body["errors"])
    assert db.get(Warehouse, removable.id) is None
    db.refresh(referenced)
    assert referenced.is_active is False


def test_delete_warehouse_rejected_when_stock_exists(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(Brand(name="Warehouse Brand", is_active=True))
    db.commit()
    product_response = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "WHSTK001",
            "name": "Warehouse Stock Product",
            "brand": "Warehouse Brand",
            "uom": "BOX",
            "is_active": True,
        },
    )
    assert product_response.status_code == 201, product_response.text
    product_id = product_response.json()["id"]

    warehouse_response = client.post(
        "/masters/warehouses",
        headers=headers,
        json={
            "name": "Stocked Warehouse",
            "code": "STKWH01",
            "address": "Pune",
            "is_active": True,
        },
    )
    assert warehouse_response.status_code == 201, warehouse_response.text
    warehouse_id = warehouse_response.json()["id"]

    batch = Batch(product_id=product_id, batch_no="STK-B1", expiry_date="2030-12-31")
    db.add(batch)
    db.commit()
    db.refresh(batch)

    stock_response = client.post(
        "/inventory/in",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch.id,
            "qty": "5",
            "reason": "PURCHASE_GRN",
        },
    )
    assert stock_response.status_code == 200, stock_response.text

    delete_response = client.delete(f"/masters/warehouses/{warehouse_id}", headers=headers)

    assert delete_response.status_code == 400, delete_response.text
    body = delete_response.json()
    assert body["error_code"] == "VALIDATION_ERROR"
    assert body["message"] == "Warehouse cannot be deleted while stock is available."
    db.refresh(db.get(Warehouse, warehouse_id))
    assert db.get(Warehouse, warehouse_id) is not None


def test_delete_product_rejected_when_stock_exists(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(Brand(name="Stock Brand", is_active=True))
    db.commit()
    product_response = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "PRDSTK01",
            "name": "Product With Stock",
            "brand": "Stock Brand",
            "uom": "BOX",
            "is_active": True,
        },
    )
    assert product_response.status_code == 201, product_response.text
    product_id = product_response.json()["id"]

    warehouse_response = client.post(
        "/masters/warehouses",
        headers=headers,
        json={
            "name": "Product Stock Warehouse",
            "code": "PSTKWH1",
            "address": "Pune",
            "is_active": True,
        },
    )
    assert warehouse_response.status_code == 201, warehouse_response.text
    warehouse_id = warehouse_response.json()["id"]

    batch = Batch(product_id=product_id, batch_no="PRD-B1", expiry_date="2030-12-31")
    db.add(batch)
    db.commit()
    db.refresh(batch)

    stock_response = client.post(
        "/inventory/in",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch.id,
            "qty": "3",
            "reason": "PURCHASE_GRN",
        },
    )
    assert stock_response.status_code == 200, stock_response.text

    delete_response = client.delete(f"/masters/products/{product_id}", headers=headers)

    assert delete_response.status_code == 400, delete_response.text
    body = delete_response.json()
    assert body["error_code"] == "VALIDATION_ERROR"
    assert body["message"] == "Product cannot be deleted while stock is available."


def test_update_product_cannot_deactivate_while_stock_exists(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(Brand(name="Inline Stock Brand", is_active=True))
    db.commit()
    product_response = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "PRDSTK02",
            "name": "Inline Deactivate Product",
            "brand": "Inline Stock Brand",
            "uom": "BOX",
            "is_active": True,
        },
    )
    assert product_response.status_code == 201, product_response.text
    product_id = product_response.json()["id"]

    warehouse_response = client.post(
        "/masters/warehouses",
        headers=headers,
        json={
            "name": "Inline Stock Warehouse",
            "code": "PSTKWH2",
            "address": "Pune",
            "is_active": True,
        },
    )
    assert warehouse_response.status_code == 201, warehouse_response.text
    warehouse_id = warehouse_response.json()["id"]

    batch = Batch(product_id=product_id, batch_no="PRD-B2", expiry_date="2030-12-31")
    db.add(batch)
    db.commit()
    db.refresh(batch)

    stock_response = client.post(
        "/inventory/in",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch.id,
            "qty": "3",
            "reason": "PURCHASE_GRN",
        },
    )
    assert stock_response.status_code == 200, stock_response.text

    # Inline-edit deactivation (PUT) must enforce the same stock guard as DELETE.
    blocked = client.put(
        f"/masters/products/{product_id}",
        headers=headers,
        json={"is_active": False},
    )
    assert blocked.status_code == 400, blocked.text
    body = blocked.json()
    assert body["error_code"] == "VALIDATION_ERROR"
    assert body["message"] == "Product cannot be deactivated while stock is available."
    still_active = client.get(f"/masters/products/{product_id}", headers=headers)
    assert still_active.json()["is_active"] is True


def test_update_product_can_deactivate_without_stock(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(Brand(name="No Stock Brand", is_active=True))
    db.commit()
    product_response = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "PRDNOSTK1",
            "name": "Deactivatable Product",
            "brand": "No Stock Brand",
            "uom": "BOX",
            "is_active": True,
        },
    )
    assert product_response.status_code == 201, product_response.text
    product_id = product_response.json()["id"]

    response = client.put(
        f"/masters/products/{product_id}",
        headers=headers,
        json={"is_active": False},
    )
    assert response.status_code == 200, response.text
    assert response.json()["is_active"] is False


def test_party_advanced_fields_persist(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, _db, headers = _headers_for_admin(client_with_test_db)
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Compliance Rich Party",
            "display_name": "Compliance Rich",
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
            "gstin": "27ABCDE1234F1Z5",
            "gst_verification_log_id": verify_gstin(client, headers, "27ABCDE1234F1Z5"),
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
    assert body["party_code"].startswith("PTY-")
    assert body["contact_person"] == "Lijo"
    assert body["drug_license_number"] == "DL-123"
    assert body["fssai_number"] == "FSSAI-123"
    assert body["udyam_number"] == "UDYAM-123"
    assert body["credit_limit"] == "125000.00"
    assert body["opening_balance"] == "1500.00"
    assert body["outstanding_tracking_mode"] == "FIFO"


def test_rack_master_and_product_rack_validation(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(Brand(name="RackBrand", is_active=True))
    db.commit()

    warehouse_response = client.post(
        "/masters/warehouses",
        headers=headers,
        json={"name": "Rack Warehouse", "code": "RACKWH", "is_active": True},
    )
    assert warehouse_response.status_code == 201, warehouse_response.text
    warehouse_id = warehouse_response.json()["id"]

    rack_response = client.post(
        "/masters/racks",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "rack_number": "A-01",
            "description": "Primary aisle",
            "is_active": True,
        },
    )
    assert rack_response.status_code == 201, rack_response.text
    created_rack = rack_response.json()
    assert created_rack["warehouse_id"] == warehouse_id
    assert created_rack["rack_number"] == "A-01"

    list_response = client.get(f"/masters/racks?warehouse_id={warehouse_id}", headers=headers)
    assert list_response.status_code == 200, list_response.text
    rack_rows = list_response.json()
    assert len(rack_rows) == 1
    assert rack_rows[0]["warehouse_name"] == "Rack Warehouse"

    invalid_product_response = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "RACK-SKU-1",
            "name": "Rack Product Invalid",
            "brand": "RackBrand",
            "uom": "BOX",
            "default_warehouse_id": warehouse_id,
            "rack_number": "Z-99",
            "is_active": True,
        },
    )
    assert invalid_product_response.status_code == 400, invalid_product_response.text
    assert invalid_product_response.json()["details"]["field"] == "rack_number"

    valid_product_response = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "RACK-SKU-2",
            "name": "Rack Product Valid",
            "brand": "RackBrand",
            "uom": "BOX",
            "default_warehouse_id": warehouse_id,
            "rack_number": "A-01",
            "is_active": True,
        },
    )
    assert valid_product_response.status_code == 201, valid_product_response.text
    assert valid_product_response.json()["rack_number"] == "A-01"

    assert db.query(Rack).filter(Rack.warehouse_id == warehouse_id).count() == 1


def test_update_product_clears_optional_fields_with_null(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(Brand(name="ClearBrand", is_active=True))
    db.commit()

    warehouse_response = client.post(
        "/masters/warehouses",
        headers=headers,
        json={"name": "Clear Warehouse", "code": "CLRWH", "is_active": True},
    )
    assert warehouse_response.status_code == 201, warehouse_response.text
    warehouse_id = warehouse_response.json()["id"]

    rack_response = client.post(
        "/masters/racks",
        headers=headers,
        json={"warehouse_id": warehouse_id, "rack_number": "C-01", "is_active": True},
    )
    assert rack_response.status_code == 201, rack_response.text

    create_response = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "CLEAR-SKU-1",
            "name": "Clearable Product",
            "display_name": "Clearable Display",
            "category": "General Medicines",
            "brand": "ClearBrand",
            "uom": "BOX",
            "default_warehouse_id": warehouse_id,
            "rack_number": "C-01",
            "is_active": True,
        },
    )
    assert create_response.status_code == 201, create_response.text
    product_id = create_response.json()["id"]

    # Sending null (not an omitted key) must actually clear optional fields.
    update_response = client.put(
        f"/masters/products/{product_id}",
        headers=headers,
        json={"display_name": None, "category": None, "rack_number": None},
    )
    assert update_response.status_code == 200, update_response.text
    body = update_response.json()
    assert body["display_name"] is None
    assert body["category"] is None
    assert body["rack_number"] is None
    # Warehouse was not part of the payload and must be retained.
    assert body["default_warehouse_id"] == warehouse_id


def _create_simple_product(client: TestClient, headers: dict, **overrides: object) -> None:
    payload = {"uom": "BOX", "is_active": True, "brand": "PageBrand"}
    payload.update(overrides)
    response = client.post("/masters/products", headers=headers, json=payload)
    assert response.status_code == 201, response.text


def test_list_products_page_paginates_orders_and_searches(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(Brand(name="PageBrand", is_active=True))
    db.commit()
    for i in range(5):
        _create_simple_product(
            client,
            headers,
            sku=f"PAGE-{i}",
            name=f"Page Product {i}",
            category="Analgesics" if i % 2 == 0 else "Antibiotics",
        )

    first = client.get("/masters/products/page?page=1&page_size=2", headers=headers)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["total"] == 5
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert len(body["data"]) == 2
    assert body["data"][0]["name"] == "Page Product 0"  # ordered by name asc

    last_page = client.get("/masters/products/page?page=3&page_size=2", headers=headers)
    assert len(last_page.json()["data"]) == 1

    search = client.get("/masters/products/page?search=page product 1", headers=headers)
    search_body = search.json()
    assert search_body["total"] == 1
    assert search_body["data"][0]["sku"] == "PAGE-1"

    cat = client.get("/masters/products/page?category=Analgesics", headers=headers)
    assert cat.json()["total"] == 3

    categories = client.get("/masters/products/categories", headers=headers)
    assert categories.status_code == 200, categories.text
    assert categories.json() == ["Analgesics", "Antibiotics"]


def test_list_products_page_filters_by_active_status(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(Brand(name="PageBrand", is_active=True))
    db.commit()
    _create_simple_product(client, headers, sku="ACT-1", name="Active One", is_active=True)
    _create_simple_product(client, headers, sku="INA-1", name="Inactive One", is_active=False)

    inactive = client.get("/masters/products/page?is_active=false", headers=headers)
    inactive_body = inactive.json()
    assert inactive_body["total"] == 1
    assert inactive_body["data"][0]["sku"] == "INA-1"

    active = client.get("/masters/products/page?is_active=true", headers=headers)
    assert [row["sku"] for row in active.json()["data"]] == ["ACT-1"]

    everything = client.get("/masters/products/page", headers=headers)
    assert everything.json()["total"] == 2


def test_product_unit_price_derived_from_mrp_and_gst(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db, headers = _headers_for_admin(client_with_test_db)
    db.add(Brand(name="PriceBrand", is_active=True))
    db.add(TaxRate(code="GST_18", label="GST 18%", rate_percent="18.00", is_active=True))
    db.commit()

    created = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "PRICE-1",
            "name": "Priced Product",
            "brand": "PriceBrand",
            "uom": "BOX",
            "gst_rate": "18.00",
            "mrp": "118.00",
            "is_active": True,
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["unit_price"] == "100.00"  # 118 / 1.18
    product_id = body["id"]

    # Removing GST recomputes unit price to equal MRP.
    no_gst = client.put(
        f"/masters/products/{product_id}",
        headers=headers,
        json={"gst_rate": None},
    )
    assert no_gst.status_code == 200, no_gst.text
    assert no_gst.json()["unit_price"] == "118.00"

    # Clearing MRP clears the derived unit price.
    cleared = client.put(
        f"/masters/products/{product_id}",
        headers=headers,
        json={"mrp": None},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["unit_price"] is None


def test_rack_report_endpoint(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    admin = _create_user(
        db,
        email="rack-report-admin@medhaone.app",
        role_names=["ADMIN"],
        is_superuser=True,
    )
    headers = {"Authorization": f"Bearer {_token_for(admin)}"}
    db.add(Brand(name="RackRptBrand", is_active=True))
    db.commit()

    warehouse = client.post(
        "/masters/warehouses",
        headers=headers,
        json={"name": "Rack Rpt WH", "code": "RKRPT", "is_active": True},
    )
    assert warehouse.status_code == 201, warehouse.text
    warehouse_id = warehouse.json()["id"]

    rack = client.post(
        "/masters/racks",
        headers=headers,
        json={"warehouse_id": warehouse_id, "rack_number": "RPT-A1", "is_active": True},
    )
    assert rack.status_code == 201, rack.text
    client.post(
        "/masters/racks",
        headers=headers,
        json={"warehouse_id": warehouse_id, "rack_number": "RPT-EMPTY", "is_active": True},
    )

    product = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "RKRPT-1",
            "name": "Rack Rpt Product",
            "brand": "RackRptBrand",
            "uom": "BOX",
            "default_warehouse_id": warehouse_id,
            "rack_number": "RPT-A1",
            "is_active": True,
        },
    )
    assert product.status_code == 201, product.text
    product_id = product.json()["id"]

    batch = Batch(product_id=product_id, batch_no="RKRPT-B1", expiry_date="2031-12-31")
    db.add(batch)
    db.commit()
    db.refresh(batch)
    stock = client.post(
        "/inventory/in",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch.id,
            "qty": "5",
            "reason": "PURCHASE_GRN",
        },
    )
    assert stock.status_code == 200, stock.text

    response = client.get("/reports/masters/rack-report", headers=headers)
    assert response.status_code == 200, response.text
    rows = {row["rack_number"]: row for row in response.json()["data"]}
    assert rows["RPT-A1"]["products_assigned"] == 1
    assert Decimal(str(rows["RPT-A1"]["total_stock_qty"])) == Decimal("5")
    # Racks with no assigned products still appear, with zero counts.
    assert rows["RPT-EMPTY"]["products_assigned"] == 0


def test_party_directory_report_filters_and_search(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    admin = _create_user(
        db,
        email="party-dir-admin@medhaone.app",
        role_names=["ADMIN"],
        is_superuser=True,
    )
    headers = {"Authorization": f"Bearer {_token_for(admin)}"}
    # Build parties directly to bypass the GSTIN-verification gate on the API.
    db.add_all(
        [
            Party(
                name="Alpha Pharma",
                party_type="SUPPLIER",
                party_category="DISTRIBUTOR",
                state="Maharashtra",
                city="Pune",
                gstin="27AAAAA0000A1Z5",
                is_active=True,
            ),
            Party(
                name="Beta Retail",
                party_type="CUSTOMER",
                party_category="PHARMACY",
                state="Karnataka",
                city="Bengaluru",
                gstin="29BBBBB1111B1Z5",
                is_active=True,
            ),
            Party(
                name="Gamma Closed",
                party_type="SUPPLIER",
                state="Maharashtra",
                city="Mumbai",
                is_active=False,
            ),
        ]
    )
    db.commit()

    base = "/reports/masters/party-directory"
    all_parties = client.get(base, headers=headers)
    assert all_parties.status_code == 200, all_parties.text
    assert all_parties.json()["total"] == 3

    # Search matches GSTIN (case-insensitive).
    by_gstin = client.get(base, headers=headers, params={"search": "27aaaaa"})
    gstin_body = by_gstin.json()
    assert gstin_body["total"] == 1
    assert gstin_body["data"][0]["party_name"] == "Alpha Pharma"

    # Location filter.
    in_mh = client.get(base, headers=headers, params={"states": "Maharashtra"})
    assert in_mh.json()["total"] == 2

    # Type + status filters.
    suppliers = client.get(base, headers=headers, params={"party_types": "SUPPLIER"})
    assert suppliers.json()["total"] == 2
    active_only = client.get(base, headers=headers, params={"active_status": "active"})
    assert active_only.json()["total"] == 2


def test_uom_master_crud_and_defaults(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    admin = _create_user(
        db,
        email="uom-admin@medhaone.app",
        role_names=["ADMIN"],
        is_superuser=True,
    )
    headers = {"Authorization": f"Bearer {_token_for(admin)}"}

    # Listing seeds the common default UOMs so the dropdown is never empty.
    listed = client.get("/masters/uoms", headers=headers)
    assert listed.status_code == 200, listed.text
    names = {row["name"] for row in listed.json()}
    assert {"EA", "BOX", "KG"}.issubset(names)

    created = client.post(
        "/masters/uoms",
        headers=headers,
        json={"name": "CASE", "is_active": True},
    )
    assert created.status_code == 201, created.text
    uom_id = created.json()["id"]

    # Case-insensitive duplicate is rejected.
    dup = client.post("/masters/uoms", headers=headers, json={"name": "case"})
    assert dup.status_code == 400, dup.text

    updated = client.patch(
        f"/masters/uoms/{uom_id}",
        headers=headers,
        json={"is_active": False},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["is_active"] is False

    # Inactive UOMs are excluded unless explicitly included.
    active_names = {row["name"] for row in client.get("/masters/uoms", headers=headers).json()}
    assert "CASE" not in active_names

    deleted = client.delete(f"/masters/uoms/{uom_id}", headers=headers)
    assert deleted.status_code == 200, deleted.text
