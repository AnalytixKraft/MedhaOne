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
from app.models.warehouse import Warehouse
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
    assert body["message"] == "GSTIN is required for Party Master"
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
                    "name": "Paracetamol 500",
                    "brand": "Medha",
                    "uom": "PCS",
                    "gst_rate": "5",
                },
                {
                    "sku": "SKU002",
                    "name": "Unknown Tax Rate",
                    "brand": "Medha",
                    "uom": "PCS",
                    "gst_rate": "18",
                },
                {
                    "sku": "SKU001",
                    "name": "Duplicate SKU",
                    "brand": "Medha",
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
    assert missing_brand_response.json()["message"] == "Brand must exist in Master Settings and be active"

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
            "gstin": "27ABCDE1234F1Z5",
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
