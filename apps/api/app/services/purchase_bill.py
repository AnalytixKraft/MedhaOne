from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Protocol
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.domain.tax_identity import normalize_and_validate_gstin
from app.models.enums import PurchaseBillExtractionStatus, PurchaseBillStatus
from app.models.party import Party
from app.models.product import Product
from app.models.purchase import GRN, PurchaseOrder
from app.models.purchase_bill import DocumentAttachment, PurchaseBill, PurchaseBillLine
from app.models.warehouse import Warehouse
from app.schemas.purchase_bill import (
    PurchaseBillExtractionLine,
    PurchaseBillExtractionPayload,
    PurchaseBillUpdate,
)
from app.services.audit import changed_fields, snapshot_model, write_audit_log

SUPPORTED_UPLOAD_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
}


class PurchaseInvoiceExtractor(Protocol):
    def extract(
        self,
        *,
        file_path: Path,
        file_name: str,
        file_type: str,
    ) -> PurchaseBillExtractionPayload:
        ...


class UnconfiguredPurchaseInvoiceExtractor:
    def extract(
        self,
        *,
        file_path: Path,
        file_name: str,
        file_type: str,
    ) -> PurchaseBillExtractionPayload:
        raise RuntimeError(
            "Purchase invoice extractor is not configured. Upload created a draft bill without extracted data.",
        )


_purchase_invoice_extractor: PurchaseInvoiceExtractor = UnconfiguredPurchaseInvoiceExtractor()


@dataclass(slots=True)
class StoredUpload:
    file_name: str
    file_type: str
    storage_path: str


def set_purchase_invoice_extractor(extractor: PurchaseInvoiceExtractor) -> None:
    global _purchase_invoice_extractor
    _purchase_invoice_extractor = extractor


def get_purchase_invoice_extractor() -> PurchaseInvoiceExtractor:
    return _purchase_invoice_extractor


def _as_decimal(value: Decimal | str | float | int | None, default: str = "0") -> Decimal:
    if value is None or value == "":
        return Decimal(default)
    return Decimal(str(value))


def _money(value: Decimal | str | float | int | None, default: str = "0") -> Decimal:
    return _as_decimal(value, default).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _qty(value: Decimal | str | float | int | None, default: str = "0") -> Decimal:
    return _as_decimal(value, default).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def _new_purchase_bill_number() -> str:
    return f"PB-{uuid4().hex[:10].upper()}"


def _storage_root() -> Path:
    root = Path(get_settings().upload_storage_dir) / "purchase-bills"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_normalize_gstin(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return normalize_and_validate_gstin(value)
    except AppException:
        return None


def _normalize_match_text(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]+", "", (value or "").upper())


def _get_purchase_bill_or_404(db: Session, bill_id: int, *, lock: bool = False) -> PurchaseBill:
    stmt = (
        select(PurchaseBill)
        .where(PurchaseBill.id == bill_id)
        .options(
            selectinload(PurchaseBill.lines),
            selectinload(PurchaseBill.attachment),
        )
    )
    if lock:
        stmt = stmt.with_for_update()
    bill = db.execute(stmt).scalar_one_or_none()
    if bill is None:
        raise AppException(
            error_code="NOT_FOUND",
            message="Purchase bill not found",
            status_code=404,
        )
    return bill


def _bill_snapshot(bill: PurchaseBill) -> dict:
    snapshot = snapshot_model(
        bill,
        fields=[
            "id",
            "bill_number",
            "supplier_id",
            "supplier_name_raw",
            "supplier_gstin",
            "bill_date",
            "due_date",
            "warehouse_id",
            "status",
            "subtotal",
            "discount_amount",
            "taxable_value",
            "cgst_amount",
            "sgst_amount",
            "igst_amount",
            "adjustment",
            "total",
            "extraction_status",
            "extraction_confidence",
            "attachment_id",
            "purchase_order_id",
            "grn_id",
            "remarks",
        ],
    )
    snapshot["lines"] = [
        snapshot_model(
            line,
            fields=[
                "id",
                "product_id",
                "description_raw",
                "hsn_code",
                "qty",
                "unit",
                "unit_price",
                "discount_amount",
                "gst_percent",
                "line_total",
                "batch_no",
                "expiry_date",
                "confidence_score",
            ],
        )
        for line in bill.lines
    ]
    return snapshot


def _store_attachment_file(*, schema_name: str, bill_id: int, file_name: str, file_bytes: bytes) -> str:
    safe_name = Path(file_name).name or f"purchase-bill-{bill_id}"
    target_dir = _storage_root() / schema_name / str(bill_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{uuid4().hex[:12]}-{safe_name}"
    target_path.write_bytes(file_bytes)
    return str(target_path)


def _match_supplier(db: Session, *, supplier_gstin: str | None, supplier_name: str | None) -> Party | None:
    normalized_gstin = _safe_normalize_gstin(supplier_gstin)
    if normalized_gstin:
        matched = db.query(Party).filter(func.upper(Party.gstin) == normalized_gstin).first()
        if matched:
            return matched

    normalized_name = (supplier_name or "").strip()
    if not normalized_name:
        return None

    matches = (
        db.query(Party)
        .filter(func.lower(Party.name) == normalized_name.lower())
        .limit(2)
        .all()
    )
    if len(matches) == 1:
        return matches[0]
    return None


def _match_product(db: Session, description_raw: str) -> Product | None:
    normalized = _normalize_match_text(description_raw)
    if not normalized:
        return None

    exact_matches = (
        db.query(Product)
        .filter(
            (func.upper(Product.sku) == normalized)
            | (func.regexp_replace(func.upper(Product.name), r"[^A-Z0-9]+", "", "g") == normalized)
        )
        .limit(2)
        .all()
    )
    if len(exact_matches) == 1:
        return exact_matches[0]

    contains_matches = [
        product
        for product in db.query(Product).all()
        if product.sku and _normalize_match_text(product.sku) in normalized
    ]
    if len(contains_matches) == 1:
        return contains_matches[0]
    return None


def _ensure_optional_refs_exist(
    db: Session,
    *,
    supplier_id: int | None = None,
    warehouse_id: int | None = None,
    purchase_order_id: int | None = None,
    grn_id: int | None = None,
) -> None:
    if supplier_id is not None and db.get(Party, supplier_id) is None:
        raise AppException(
            error_code="NOT_FOUND",
            message="Supplier not found",
            status_code=404,
        )
    if warehouse_id is not None and db.get(Warehouse, warehouse_id) is None:
        raise AppException(
            error_code="NOT_FOUND",
            message="Warehouse not found",
            status_code=404,
        )
    if purchase_order_id is not None and db.get(PurchaseOrder, purchase_order_id) is None:
        raise AppException(
            error_code="NOT_FOUND",
            message="Purchase order not found",
            status_code=404,
        )
    if grn_id is not None and db.get(GRN, grn_id) is None:
        raise AppException(
            error_code="NOT_FOUND",
            message="GRN not found",
            status_code=404,
        )


def _apply_line_updates(
    bill: PurchaseBill,
    *,
    lines: list[PurchaseBillExtractionLine] | list,
    db: Session,
) -> None:
    bill.lines.clear()
    for line_payload in lines:
        matched_product = _match_product(db, line_payload.description_raw)
        line_total = _money(
            line_payload.line_total
            if line_payload.line_total is not None
            else (_qty(line_payload.qty) * _money(line_payload.unit_price)),
        )
        bill.lines.append(
            PurchaseBillLine(
                product_id=matched_product.id if matched_product else getattr(line_payload, "product_id", None),
                description_raw=line_payload.description_raw,
                hsn_code=line_payload.hsn_code,
                qty=_qty(line_payload.qty),
                unit=line_payload.unit,
                unit_price=_money(line_payload.unit_price),
                discount_amount=_money(line_payload.discount_amount),
                gst_percent=_money(line_payload.gst_percent),
                line_total=line_total,
                batch_no=line_payload.batch_no,
                expiry_date=line_payload.expiry_date,
                confidence_score=_money(line_payload.confidence_score) if line_payload.confidence_score is not None else None,
            )
        )


def _recalculate_totals(bill: PurchaseBill) -> None:
    line_subtotal = _money(sum((_qty(line.qty) * _money(line.unit_price)) for line in bill.lines), "0")
    line_discount = _money(sum((_money(line.discount_amount) for line in bill.lines), Decimal("0")))
    if bill.subtotal == Decimal("0.00"):
        bill.subtotal = line_subtotal
    if bill.discount_amount == Decimal("0.00"):
        bill.discount_amount = line_discount
    if bill.taxable_value == Decimal("0.00"):
        bill.taxable_value = _money(bill.subtotal - bill.discount_amount)
    bill.total = _money(
        bill.taxable_value
        + bill.cgst_amount
        + bill.sgst_amount
        + bill.igst_amount
        + bill.adjustment
    )


def _validate_bill_totals(bill: PurchaseBill) -> None:
    if bill.total < 0:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Bill total cannot be negative",
            status_code=400,
            details={"field": "total"},
        )
    expected_total = _money(
        bill.taxable_value
        + bill.cgst_amount
        + bill.sgst_amount
        + bill.igst_amount
        + bill.adjustment
    )
    if abs(expected_total - _money(bill.total)) > Decimal("0.01"):
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Bill total does not match taxable value plus taxes and adjustment",
            status_code=400,
            details={"field": "total"},
        )
    for index, line in enumerate(bill.lines):
        if line.line_total < 0 or line.qty < 0:
            raise AppException(
                error_code="VALIDATION_ERROR",
                message="Bill line values must be non-negative",
                status_code=400,
                details={"line_index": index},
            )


def _apply_extraction_payload(db: Session, bill: PurchaseBill, payload: PurchaseBillExtractionPayload) -> None:
    matched_supplier = _match_supplier(
        db,
        supplier_gstin=payload.supplier_gstin,
        supplier_name=payload.supplier_name,
    )
    bill.bill_number = payload.invoice_number or bill.bill_number
    bill.supplier_id = matched_supplier.id if matched_supplier else bill.supplier_id
    bill.supplier_name_raw = payload.supplier_name or bill.supplier_name_raw
    bill.supplier_gstin = payload.supplier_gstin or bill.supplier_gstin
    bill.bill_date = payload.invoice_date or bill.bill_date
    bill.due_date = payload.due_date or bill.due_date
    bill.subtotal = _money(payload.subtotal)
    bill.discount_amount = _money(payload.discount_amount)
    bill.taxable_value = _money(payload.taxable_value)
    bill.cgst_amount = _money(payload.cgst_amount)
    bill.sgst_amount = _money(payload.sgst_amount)
    bill.igst_amount = _money(payload.igst_amount)
    bill.adjustment = _money(payload.adjustment)
    bill.total = _money(payload.total)
    bill.extracted_json = payload.model_dump(mode="json")
    bill.extraction_confidence = _money(payload.confidence) if payload.confidence is not None else None
    _apply_line_updates(bill, lines=payload.line_items, db=db)
    _recalculate_totals(bill)
    bill.extraction_status = PurchaseBillExtractionStatus.EXTRACTED


def list_purchase_bills(db: Session) -> list[PurchaseBill]:
    return (
        db.query(PurchaseBill)
        .options(
            selectinload(PurchaseBill.lines),
            selectinload(PurchaseBill.attachment),
        )
        .order_by(PurchaseBill.created_at.desc(), PurchaseBill.id.desc())
        .all()
    )


def get_purchase_bill(db: Session, bill_id: int) -> PurchaseBill:
    return _get_purchase_bill_or_404(db, bill_id)


def get_document_attachment(db: Session, attachment_id: int) -> DocumentAttachment:
    attachment = db.get(DocumentAttachment, attachment_id)
    if attachment is None:
        raise AppException(
            error_code="NOT_FOUND",
            message="Attachment not found",
            status_code=404,
        )
    return attachment


def upload_purchase_bill(
    db: Session,
    *,
    file_name: str,
    file_type: str,
    file_bytes: bytes,
    created_by: int,
    warehouse_id: int | None = None,
) -> PurchaseBill:
    if file_type not in SUPPORTED_UPLOAD_TYPES:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Only PDF, JPG, and PNG invoices are supported",
            status_code=400,
            details={"field": "file"},
        )
    if warehouse_id is not None and db.get(Warehouse, warehouse_id) is None:
        raise AppException(
            error_code="NOT_FOUND",
            message="Warehouse not found",
            status_code=404,
        )

    schema_name = str(db.info.get("tenant_schema") or db.execute(select(func.current_schema())).scalar_one())
    bill = PurchaseBill(
        bill_number=_new_purchase_bill_number(),
        warehouse_id=warehouse_id,
        status=PurchaseBillStatus.DRAFT,
        extraction_status=PurchaseBillExtractionStatus.NOT_STARTED,
        created_by=created_by,
    )
    db.add(bill)
    db.flush()

    storage_path = _store_attachment_file(
        schema_name=schema_name,
        bill_id=bill.id,
        file_name=file_name,
        file_bytes=file_bytes,
    )
    attachment = DocumentAttachment(
        entity_type="PURCHASE_BILL",
        entity_id=bill.id,
        file_name=file_name,
        file_type=file_type,
        storage_path=storage_path,
        uploaded_by=created_by,
    )
    db.add(attachment)
    db.flush()
    bill.attachment_id = attachment.id

    write_audit_log(
        db,
        module="Purchase Bill",
        action="CREATE",
        entity_type="PURCHASE_BILL",
        entity_id=bill.id,
        performed_by=created_by,
        summary=f"Uploaded invoice {file_name}",
        source_screen="Purchase / Bills",
        after_snapshot=_bill_snapshot(bill),
        metadata={"attachment_id": attachment.id, "file_name": file_name},
    )

    try:
        extraction = get_purchase_invoice_extractor().extract(
            file_path=Path(storage_path),
            file_name=file_name,
            file_type=file_type,
        )
        _apply_extraction_payload(db, bill, extraction)
        write_audit_log(
            db,
            module="Purchase Bill",
            action="UPDATE",
            entity_type="PURCHASE_BILL",
            entity_id=bill.id,
            performed_by=created_by,
            summary="Completed invoice extraction",
            source_screen="Purchase / Bills",
            after_snapshot=_bill_snapshot(bill),
            metadata={
                "extraction_confidence": str(bill.extraction_confidence) if bill.extraction_confidence is not None else None,
            },
        )
    except Exception as exc:
        bill.extraction_status = PurchaseBillExtractionStatus.FAILED
        bill.remarks = str(exc)
        write_audit_log(
            db,
            module="Purchase Bill",
            action="UPDATE",
            entity_type="PURCHASE_BILL",
            entity_id=bill.id,
            performed_by=created_by,
            summary="Invoice extraction failed",
            source_screen="Purchase / Bills",
            after_snapshot=_bill_snapshot(bill),
            metadata={"error": str(exc)},
        )

    db.commit()
    db.refresh(bill)
    return _get_purchase_bill_or_404(db, bill.id)


def update_purchase_bill(
    db: Session,
    bill_id: int,
    payload: PurchaseBillUpdate,
    *,
    updated_by: int,
) -> PurchaseBill:
    bill = _get_purchase_bill_or_404(db, bill_id, lock=True)
    if bill.status == PurchaseBillStatus.POSTED:
        raise AppException(
            error_code="CONFLICT",
            message="Posted purchase bills are immutable",
            status_code=409,
        )

    before_snapshot = _bill_snapshot(bill)
    _ensure_optional_refs_exist(
        db,
        supplier_id=payload.supplier_id,
        warehouse_id=payload.warehouse_id,
        purchase_order_id=payload.purchase_order_id,
        grn_id=payload.grn_id,
    )

    for field in [
        "bill_number",
        "supplier_id",
        "supplier_name_raw",
        "supplier_gstin",
        "bill_date",
        "due_date",
        "warehouse_id",
        "purchase_order_id",
        "grn_id",
        "remarks",
    ]:
        value = getattr(payload, field)
        if value is not None:
            setattr(bill, field, value)

    for field in [
        "subtotal",
        "discount_amount",
        "taxable_value",
        "cgst_amount",
        "sgst_amount",
        "igst_amount",
        "adjustment",
        "total",
    ]:
        value = getattr(payload, field)
        if value is not None:
            setattr(bill, field, _money(value))

    if payload.lines is not None:
        _apply_line_updates(bill, lines=payload.lines, db=db)

    _recalculate_totals(bill)
    _validate_bill_totals(bill)
    db.flush()

    after_snapshot = _bill_snapshot(bill)
    write_audit_log(
        db,
        module="Purchase Bill",
        action="UPDATE",
        entity_type="PURCHASE_BILL",
        entity_id=bill.id,
        performed_by=updated_by,
        summary="Updated purchase bill draft",
        source_screen="Purchase / Bills / Review",
        before_snapshot=before_snapshot,
        after_snapshot=after_snapshot,
        metadata={"changed_fields": changed_fields(before_snapshot, after_snapshot)},
    )
    db.commit()
    return _get_purchase_bill_or_404(db, bill.id)


def verify_purchase_bill(db: Session, bill_id: int, *, verified_by: int) -> PurchaseBill:
    bill = _get_purchase_bill_or_404(db, bill_id, lock=True)
    if bill.status == PurchaseBillStatus.POSTED:
        raise AppException(
            error_code="CONFLICT",
            message="Posted purchase bills cannot be verified again",
            status_code=409,
        )
    if bill.supplier_id is None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Select a supplier before verifying the bill",
            status_code=400,
            details={"field": "supplier_id"},
        )
    if bill.bill_date is None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Bill date is required",
            status_code=400,
            details={"field": "bill_date"},
        )
    if not bill.lines:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="At least one bill line is required",
            status_code=400,
            details={"field": "lines"},
        )

    before_snapshot = _bill_snapshot(bill)
    _validate_bill_totals(bill)
    bill.status = PurchaseBillStatus.VERIFIED
    bill.extraction_status = PurchaseBillExtractionStatus.REVIEWED
    db.flush()
    after_snapshot = _bill_snapshot(bill)
    write_audit_log(
        db,
        module="Purchase Bill",
        action="VERIFY",
        entity_type="PURCHASE_BILL",
        entity_id=bill.id,
        performed_by=verified_by,
        summary="Verified purchase bill",
        source_screen="Purchase / Bills / Review",
        before_snapshot=before_snapshot,
        after_snapshot=after_snapshot,
    )
    db.commit()
    return _get_purchase_bill_or_404(db, bill.id)


def post_purchase_bill(db: Session, bill_id: int, *, posted_by: int) -> PurchaseBill:
    bill = _get_purchase_bill_or_404(db, bill_id, lock=True)
    if bill.status == PurchaseBillStatus.POSTED:
        raise AppException(
            error_code="CONFLICT",
            message="Purchase bill is already posted",
            status_code=409,
        )
    if bill.status != PurchaseBillStatus.VERIFIED:
        raise AppException(
            error_code="CONFLICT",
            message="Verify the purchase bill before posting",
            status_code=409,
        )

    before_snapshot = _bill_snapshot(bill)
    bill.status = PurchaseBillStatus.POSTED
    db.flush()
    after_snapshot = _bill_snapshot(bill)
    write_audit_log(
        db,
        module="Purchase Bill",
        action="POST",
        entity_type="PURCHASE_BILL",
        entity_id=bill.id,
        performed_by=posted_by,
        summary="Posted purchase bill",
        source_screen="Purchase / Bills / Review",
        before_snapshot=before_snapshot,
        after_snapshot=after_snapshot,
    )
    db.commit()
    return _get_purchase_bill_or_404(db, bill.id)


def cancel_purchase_bill(db: Session, bill_id: int, *, cancelled_by: int) -> PurchaseBill:
    bill = _get_purchase_bill_or_404(db, bill_id, lock=True)
    if bill.status == PurchaseBillStatus.POSTED:
        raise AppException(
            error_code="CONFLICT",
            message="Posted purchase bill cannot be cancelled",
            status_code=409,
        )

    before_snapshot = _bill_snapshot(bill)
    bill.status = PurchaseBillStatus.CANCELLED
    db.flush()
    after_snapshot = _bill_snapshot(bill)
    write_audit_log(
        db,
        module="Purchase Bill",
        action="CANCEL",
        entity_type="PURCHASE_BILL",
        entity_id=bill.id,
        performed_by=cancelled_by,
        summary="Cancelled purchase bill",
        source_screen="Purchase / Bills / Review",
        before_snapshot=before_snapshot,
        after_snapshot=after_snapshot,
    )
    db.commit()
    return _get_purchase_bill_or_404(db, bill.id)
