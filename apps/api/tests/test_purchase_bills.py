from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.audit import AuditLog
from app.models.enums import PurchaseBillExtractionStatus, PurchaseBillStatus
from app.models.inventory import InventoryLedger
from app.models.party import Party
from app.models.product import Product
from app.models.warehouse import Warehouse
from app.schemas.purchase_bill import PurchaseBillExtractionPayload
from app.services.purchase_bill import get_purchase_invoice_extractor, set_purchase_invoice_extractor
from app.testing import create_restricted_headers, create_superuser_headers


class MockExtractor:
    def __init__(self, payload: PurchaseBillExtractionPayload):
        self.payload = payload

    def extract(self, **_: object) -> PurchaseBillExtractionPayload:
        return self.payload


def _seed_supplier(db: Session, *, name: str, gstin: str | None) -> Party:
    supplier = Party(
        name=name,
        party_type="SUPER_STOCKIST",
        gstin=gstin,
        state="Maharashtra",
        is_active=True,
    )
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


def _seed_warehouse(db: Session) -> Warehouse:
    warehouse = Warehouse(name="Purchase Bill WH", code="PBWH", is_active=True)
    db.add(warehouse)
    db.commit()
    db.refresh(warehouse)
    return warehouse


def _seed_product(db: Session, *, sku: str, name: str) -> Product:
    product = Product(sku=sku, name=name, brand="AK", uom="BOX", is_active=True)
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _upload_invoice(
    client: TestClient,
    headers: dict[str, str],
    *,
    warehouse_id: int | None = None,
) -> dict:
    data: dict[str, str] = {}
    if warehouse_id is not None:
        data["warehouse_id"] = str(warehouse_id)
    response = client.post(
        "/purchase-bills/upload",
        headers=headers,
        data=data,
        files={"file": ("invoice.pdf", b"%PDF-1.4 purchase bill test", "application/pdf")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _mock_payload(*, supplier_name: str, supplier_gstin: str | None) -> PurchaseBillExtractionPayload:
    return PurchaseBillExtractionPayload.model_validate(
        {
            "supplier_name": supplier_name,
            "supplier_gstin": supplier_gstin,
            "invoice_number": "INV-1001",
            "invoice_date": "2026-03-08",
            "due_date": "2026-03-18",
            "subtotal": "1000.00",
            "discount_amount": "50.00",
            "taxable_value": "950.00",
            "cgst_amount": "57.00",
            "sgst_amount": "57.00",
            "igst_amount": "0.00",
            "total": "1064.00",
            "confidence": "0.88",
            "line_items": [
                {
                    "description_raw": "SKU-PB-1 Product PB 1",
                    "qty": "10",
                    "unit": "BOX",
                    "unit_price": "100.00",
                    "discount_amount": "50.00",
                    "gst_percent": "12.00",
                    "line_total": "950.00",
                    "hsn_code": "3004",
                    "confidence_score": "0.92",
                }
            ],
        }
    )


def test_upload_creates_draft_bill_and_audit(
    client_with_test_db: tuple[TestClient, Session],
    tmp_path,
) -> None:
    client, db = client_with_test_db
    headers, user = create_superuser_headers(db, "purchase-bill-upload@medhaone.app")
    warehouse = _seed_warehouse(db)
    _seed_product(db, sku="SKU-PB-1", name="Product PB 1")

    settings = get_settings()
    original_storage_dir = settings.upload_storage_dir
    original_extractor = get_purchase_invoice_extractor()
    settings.upload_storage_dir = str(tmp_path)
    set_purchase_invoice_extractor(
        MockExtractor(_mock_payload(supplier_name="Unmatched Supplier", supplier_gstin=None))
    )
    try:
        body = _upload_invoice(client, headers, warehouse_id=warehouse.id)
    finally:
        settings.upload_storage_dir = original_storage_dir
        set_purchase_invoice_extractor(original_extractor)

    assert body["status"] == PurchaseBillStatus.DRAFT.value
    assert body["extraction_status"] == PurchaseBillExtractionStatus.EXTRACTED.value
    assert body["attachment_id"] is not None
    assert body["warehouse_id"] == warehouse.id
    assert body["supplier_id"] is None
    assert len(body["lines"]) == 1

    audit = db.query(AuditLog).filter(AuditLog.entity_type == "PURCHASE_BILL").first()
    assert audit is not None
    assert audit.module == "Purchase Bill"


def test_extraction_payload_maps_into_bill_correctly(
    client_with_test_db: tuple[TestClient, Session],
    tmp_path,
) -> None:
    client, db = client_with_test_db
    headers, _user = create_superuser_headers(db, "purchase-bill-map@medhaone.app")
    _seed_product(db, sku="SKU-PB-1", name="Product PB 1")

    settings = get_settings()
    original_storage_dir = settings.upload_storage_dir
    original_extractor = get_purchase_invoice_extractor()
    settings.upload_storage_dir = str(tmp_path)
    set_purchase_invoice_extractor(
        MockExtractor(_mock_payload(supplier_name="Map Supplier", supplier_gstin="27ABCDE1234F1Z5"))
    )
    try:
        body = _upload_invoice(client, headers)
    finally:
        settings.upload_storage_dir = original_storage_dir
        set_purchase_invoice_extractor(original_extractor)

    assert body["bill_number"] == "INV-1001"
    assert body["subtotal"] == "1000.00"
    assert body["discount_amount"] == "50.00"
    assert body["taxable_value"] == "950.00"
    assert body["cgst_amount"] == "57.00"
    assert body["sgst_amount"] == "57.00"
    assert body["total"] == "1064.00"
    assert body["extraction_confidence"] == "0.88"
    assert body["lines"][0]["description_raw"] == "SKU-PB-1 Product PB 1"
    assert body["lines"][0]["product_id"] is not None


def test_supplier_gstin_matching_works(client_with_test_db: tuple[TestClient, Session], tmp_path) -> None:
    client, db = client_with_test_db
    headers, _user = create_superuser_headers(db, "purchase-bill-supplier@medhaone.app")
    supplier = _seed_supplier(db, name="Matched Supplier", gstin="27ABCDE1234F1Z5")

    settings = get_settings()
    original_storage_dir = settings.upload_storage_dir
    original_extractor = get_purchase_invoice_extractor()
    settings.upload_storage_dir = str(tmp_path)
    set_purchase_invoice_extractor(
        MockExtractor(_mock_payload(supplier_name="Some Other Name", supplier_gstin="27ABCDE1234F1Z5"))
    )
    try:
        body = _upload_invoice(client, headers)
    finally:
        settings.upload_storage_dir = original_storage_dir
        set_purchase_invoice_extractor(original_extractor)

    assert body["supplier_id"] == supplier.id


def test_unmatched_supplier_remains_editable(client_with_test_db: tuple[TestClient, Session], tmp_path) -> None:
    client, db = client_with_test_db
    headers, _user = create_superuser_headers(db, "purchase-bill-edit@medhaone.app")
    supplier = _seed_supplier(db, name="Manual Supplier", gstin="27AAAAA1111A1Z1")

    settings = get_settings()
    original_storage_dir = settings.upload_storage_dir
    original_extractor = get_purchase_invoice_extractor()
    settings.upload_storage_dir = str(tmp_path)
    set_purchase_invoice_extractor(
        MockExtractor(_mock_payload(supplier_name="Needs Review", supplier_gstin=None))
    )
    try:
        body = _upload_invoice(client, headers)
    finally:
        settings.upload_storage_dir = original_storage_dir
        set_purchase_invoice_extractor(original_extractor)

    response = client.patch(
        f"/purchase-bills/{body['id']}",
        headers=headers,
        json={
            "supplier_id": supplier.id,
            "bill_date": "2026-03-08",
            "total": "1064.00",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["supplier_id"] == supplier.id


def test_bill_can_be_verified_after_review(client_with_test_db: tuple[TestClient, Session], tmp_path) -> None:
    client, db = client_with_test_db
    headers, _user = create_superuser_headers(db, "purchase-bill-verify@medhaone.app")
    supplier = _seed_supplier(db, name="Verified Supplier", gstin="27ABCDE1234F1Z5")
    _seed_product(db, sku="SKU-PB-1", name="Product PB 1")

    settings = get_settings()
    original_storage_dir = settings.upload_storage_dir
    original_extractor = get_purchase_invoice_extractor()
    settings.upload_storage_dir = str(tmp_path)
    set_purchase_invoice_extractor(
        MockExtractor(_mock_payload(supplier_name=supplier.name, supplier_gstin=supplier.gstin))
    )
    try:
        body = _upload_invoice(client, headers)
    finally:
        settings.upload_storage_dir = original_storage_dir
        set_purchase_invoice_extractor(original_extractor)

    response = client.post(f"/purchase-bills/{body['id']}/verify", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == PurchaseBillStatus.VERIFIED.value
    assert response.json()["extraction_status"] == PurchaseBillExtractionStatus.REVIEWED.value


def test_bill_posting_does_not_affect_stock(client_with_test_db: tuple[TestClient, Session], tmp_path) -> None:
    client, db = client_with_test_db
    headers, _user = create_superuser_headers(db, "purchase-bill-post@medhaone.app")
    supplier = _seed_supplier(db, name="Posted Supplier", gstin="27ABCDE1234F1Z5")
    _seed_product(db, sku="SKU-PB-1", name="Product PB 1")

    settings = get_settings()
    original_storage_dir = settings.upload_storage_dir
    original_extractor = get_purchase_invoice_extractor()
    settings.upload_storage_dir = str(tmp_path)
    set_purchase_invoice_extractor(
        MockExtractor(_mock_payload(supplier_name=supplier.name, supplier_gstin=supplier.gstin))
    )
    try:
        body = _upload_invoice(client, headers)
    finally:
        settings.upload_storage_dir = original_storage_dir
        set_purchase_invoice_extractor(original_extractor)

    verify_response = client.post(f"/purchase-bills/{body['id']}/verify", headers=headers)
    assert verify_response.status_code == 200, verify_response.text
    ledger_count_before = db.query(InventoryLedger).count()

    post_response = client.post(f"/purchase-bills/{body['id']}/post", headers=headers)
    assert post_response.status_code == 200, post_response.text
    assert post_response.json()["status"] == PurchaseBillStatus.POSTED.value
    assert db.query(InventoryLedger).count() == ledger_count_before


def test_unauthorized_user_is_denied(client_with_test_db: tuple[TestClient, Session], tmp_path) -> None:
    client, db = client_with_test_db
    headers = create_restricted_headers(db, "purchase-bill-denied@medhaone.app")

    settings = get_settings()
    original_storage_dir = settings.upload_storage_dir
    settings.upload_storage_dir = str(tmp_path)
    try:
        response = client.post(
            "/purchase-bills/upload",
            headers=headers,
            files={"file": ("invoice.pdf", b"%PDF-1.4 denied", "application/pdf")},
        )
    finally:
        settings.upload_storage_dir = original_storage_dir

    assert response.status_code == 403, response.text
