from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from app.core.database import set_tenant_search_path
from app.core.exceptions import AppException
from app.domain.state_machine import PurchaseStateMachine
from app.domain.tax_identity import derive_state_from_gstin, normalize_and_validate_gstin
from app.models.batch import Batch
from app.models.company_settings import CompanySettings
from app.models.enums import (
    GrnStatus,
    InventoryReason,
    PurchaseCreditNoteStatus,
    PurchaseOrderStatus,
    PurchaseReturnStatus,
)
from app.models.party import Party
from app.models.product import Product
from app.models.purchase import (
    GRN,
    GRNLine,
    PurchaseCreditNote,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from app.models.warehouse import Warehouse
from app.schemas.purchase import GRNCreateFromPO, PurchaseOrderCreate
from app.services.audit import write_audit_log
from app.services.inventory import stock_in

logger = logging.getLogger(__name__)


def _as_decimal(value: Decimal | float | int) -> Decimal:
    return Decimal(str(value))


def _money(value: Decimal | float | int) -> Decimal:
    return _as_decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _new_po_number() -> str:
    return f"PO-{uuid4().hex[:10].upper()}"


def _new_grn_number() -> str:
    return f"GRN-{uuid4().hex[:10].upper()}"


def _new_purchase_return_number() -> str:
    return f"PRN-{uuid4().hex[:10].upper()}"


def _new_credit_note_number() -> str:
    return f"PCN-{uuid4().hex[:10].upper()}"


def _raise_purchase_error(
    *,
    error_code: str,
    message: str,
    status_code: int,
    details: dict | list | str | None = None,
) -> None:
    raise AppException(
        error_code=error_code,
        message=message,
        status_code=status_code,
        details=details,
    )


def _get_po_with_lines(db: Session, po_id: int, lock: bool = False) -> PurchaseOrder | None:
    stmt = (
        select(PurchaseOrder)
        .where(PurchaseOrder.id == po_id)
        .options(selectinload(PurchaseOrder.lines))
    )
    if lock:
        stmt = stmt.with_for_update()
    return db.execute(stmt).scalar_one_or_none()


def _get_grn_with_lines(db: Session, grn_id: int, lock: bool = False) -> GRN | None:
    stmt = select(GRN).where(GRN.id == grn_id).options(selectinload(GRN.lines))
    if lock:
        stmt = stmt.with_for_update()
    return db.execute(stmt).scalar_one_or_none()


def _get_purchase_return_with_lines(
    db: Session,
    purchase_return_id: int,
    lock: bool = False,
) -> PurchaseReturn | None:
    stmt = (
        select(PurchaseReturn)
        .where(PurchaseReturn.id == purchase_return_id)
        .options(
            selectinload(PurchaseReturn.lines),
            selectinload(PurchaseReturn.credit_note),
        )
    )
    if lock:
        stmt = stmt.with_for_update()
    return db.execute(stmt).scalar_one_or_none()


def _assert_master_refs(db: Session, *, supplier_id: int, warehouse_id: int) -> None:
    if not db.get(Party, supplier_id):
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Supplier not found",
            status_code=404,
        )
    if not db.get(Warehouse, warehouse_id):
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Warehouse not found",
            status_code=404,
        )


def _company_settings_table_exists(db: Session) -> bool:
    return (
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = current_schema()
                  AND table_name = 'company_settings'
                """
            )
        ).scalar_one_or_none()
        is not None
    )


def _get_company_gstin(db: Session) -> str | None:
    if not _company_settings_table_exists(db):
        return None
    settings = db.query(CompanySettings).filter(CompanySettings.id == 1).first()
    if settings is None or not settings.gst_number:
        return None
    return normalize_and_validate_gstin(settings.gst_number)


def _calculate_po_financials(
    db: Session,
    *,
    payload: PurchaseOrderCreate,
    supplier: Party,
) -> dict[str, Decimal | str]:
    subtotal = _money(
        sum(
            _as_decimal(line.ordered_qty) * _as_decimal(line.unit_cost or Decimal("0"))
            for line in payload.lines
        )
    )
    discount_percent = _money(payload.discount_percent)
    discount_amount = _money((subtotal * discount_percent) / Decimal("100"))
    taxable_value = _money(subtotal - discount_amount)
    gst_percent = _money(payload.gst_percent)
    adjustment = _money(payload.adjustment)

    supplier_gstin = normalize_and_validate_gstin(supplier.gstin) if supplier.gstin else None
    company_gstin = _get_company_gstin(db)
    supplier_state = derive_state_from_gstin(supplier_gstin) if supplier_gstin else None
    company_state = derive_state_from_gstin(company_gstin) if company_gstin else None

    if gst_percent > 0:
        if not company_gstin or not company_state:
            _raise_purchase_error(
                error_code="VALIDATION_ERROR",
                message="Company GSTIN not configured. Cannot determine CGST/SGST/IGST automatically.",
                status_code=400,
                details={"field": "company_gstin"},
            )
        if not supplier_gstin or not supplier_state:
            _raise_purchase_error(
                error_code="VALIDATION_ERROR",
                message="Supplier GSTIN not configured. Cannot determine CGST/SGST/IGST automatically.",
                status_code=400,
                details={"field": "supplier_gstin"},
            )

    tax_type = "UNDETERMINED"
    cgst_percent = Decimal("0.00")
    sgst_percent = Decimal("0.00")
    igst_percent = Decimal("0.00")

    if gst_percent > 0 and company_state and supplier_state:
        if company_state == supplier_state:
            half_rate = _money(gst_percent / Decimal("2"))
            cgst_percent = half_rate
            sgst_percent = half_rate
            tax_type = "INTRA_STATE"
        else:
            igst_percent = gst_percent
            tax_type = "INTER_STATE"

    cgst_amount = _money((taxable_value * cgst_percent) / Decimal("100"))
    sgst_amount = _money((taxable_value * sgst_percent) / Decimal("100"))
    igst_amount = _money((taxable_value * igst_percent) / Decimal("100"))
    final_total = _money(taxable_value + cgst_amount + sgst_amount + igst_amount + adjustment)

    if final_total < 0:
        _raise_purchase_error(
            error_code="VALIDATION_ERROR",
            message="Final total cannot be negative",
            status_code=400,
            details={"field": "final_total"},
        )

    return {
        "tax_type": tax_type,
        "subtotal": subtotal,
        "discount_percent": discount_percent,
        "discount_amount": discount_amount,
        "taxable_value": taxable_value,
        "gst_percent": gst_percent,
        "cgst_percent": cgst_percent,
        "sgst_percent": sgst_percent,
        "igst_percent": igst_percent,
        "cgst_amount": cgst_amount,
        "sgst_amount": sgst_amount,
        "igst_amount": igst_amount,
        "adjustment": adjustment,
        "final_total": final_total,
    }


def _assert_product_exists(db: Session, product_id: int) -> None:
    if not db.get(Product, product_id):
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message=f"Product not found: {product_id}",
            status_code=404,
        )


def _assert_batch_exists_for_product(db: Session, *, batch_id: int, product_id: int) -> Batch:
    batch = db.get(Batch, batch_id)
    if not batch:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Batch not found",
            status_code=404,
        )
    if batch.product_id != product_id:
        _raise_purchase_error(
            error_code="INVALID_STATE",
            message="Batch does not belong to the selected product",
            status_code=400,
        )
    return batch


def _assert_po_receivable(po: PurchaseOrder) -> None:
    if po.status in (PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIALLY_RECEIVED):
        return
    if po.status in (PurchaseOrderStatus.CLOSED, PurchaseOrderStatus.CANCELLED):
        _raise_purchase_error(
            error_code="INVALID_STATE",
            message="Purchase order cannot be modified once closed or cancelled",
            status_code=409,
        )
    _raise_purchase_error(
        error_code="PO_NOT_APPROVED",
        message="Purchase order must be APPROVED or PARTIALLY_RECEIVED to accept receipts",
        status_code=409,
    )


def _add_audit_log(
    db: Session,
    *,
    entity_type: str,
    entity_id: int,
    action: str,
    performed_by: int,
    metadata: dict | None = None,
) -> None:
    write_audit_log(
        db,
        module="Purchase",
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        performed_by=performed_by,
        summary=metadata.get("summary") if metadata else None,
        source_reference=metadata.get("reference") if metadata else None,
        metadata=metadata,
    )


def _commit_with_tenant_context(db: Session) -> None:
    db.commit()
    tenant_schema = db.info.get("tenant_schema")
    if isinstance(tenant_schema, str) and tenant_schema:
        set_tenant_search_path(db, tenant_schema)


def create_po(db: Session, payload: PurchaseOrderCreate, created_by: int) -> PurchaseOrder:
    if not payload.lines:
        _raise_purchase_error(
            error_code="INVALID_STATE",
            message="Purchase order must include at least one line",
            status_code=400,
        )

    _assert_master_refs(db, supplier_id=payload.supplier_id, warehouse_id=payload.warehouse_id)
    supplier = db.get(Party, payload.supplier_id)
    if supplier is None:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Supplier not found",
            status_code=404,
        )

    try:
        financials = _calculate_po_financials(db, payload=payload, supplier=supplier)
        po = PurchaseOrder(
            po_number=_new_po_number(),
            supplier_id=payload.supplier_id,
            warehouse_id=payload.warehouse_id,
            status=PurchaseOrderStatus.DRAFT,
            order_date=payload.order_date,
            expected_date=payload.expected_date,
            notes=payload.notes,
            tax_type=str(financials["tax_type"]),
            subtotal=_as_decimal(financials["subtotal"]),
            discount_percent=_as_decimal(financials["discount_percent"]),
            discount_amount=_as_decimal(financials["discount_amount"]),
            taxable_value=_as_decimal(financials["taxable_value"]),
            gst_percent=_as_decimal(financials["gst_percent"]),
            cgst_percent=_as_decimal(financials["cgst_percent"]),
            sgst_percent=_as_decimal(financials["sgst_percent"]),
            igst_percent=_as_decimal(financials["igst_percent"]),
            cgst_amount=_as_decimal(financials["cgst_amount"]),
            sgst_amount=_as_decimal(financials["sgst_amount"]),
            igst_amount=_as_decimal(financials["igst_amount"]),
            adjustment=_as_decimal(financials["adjustment"]),
            final_total=_as_decimal(financials["final_total"]),
            created_by=created_by,
        )

        db.add(po)
        db.flush()

        for line in payload.lines:
            _assert_product_exists(db, line.product_id)
            po.lines.append(
                PurchaseOrderLine(
                    product_id=line.product_id,
                    ordered_qty=_as_decimal(line.ordered_qty),
                    received_qty=Decimal("0"),
                    unit_cost=line.unit_cost,
                    free_qty=_as_decimal(line.free_qty),
                    line_notes=line.line_notes,
                )
            )

        _add_audit_log(
            db,
            entity_type="PO",
            entity_id=po.id,
            action="CREATE",
            performed_by=created_by,
            metadata={"po_number": po.po_number},
        )
        _commit_with_tenant_context(db)
    except AppException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception(
            "Purchase order creation failed",
            extra={
                "supplier_id": payload.supplier_id,
                "warehouse_id": payload.warehouse_id,
                "line_count": len(payload.lines),
                "created_by": created_by,
            },
        )
        raise AppException(
            error_code="PURCHASE_ORDER_CREATE_FAILED",
            message="Failed to create purchase order",
            status_code=500,
        )

    return _get_po_with_lines(db, po.id)  # type: ignore[return-value]


def create_purchase_return(
    db: Session,
    *,
    supplier_id: int,
    warehouse_id: int,
    lines: list[dict[str, object]],
    created_by: int,
) -> PurchaseReturn:
    if not lines:
        _raise_purchase_error(
            error_code="INVALID_STATE",
            message="Purchase return must include at least one line",
            status_code=400,
        )

    _assert_master_refs(db, supplier_id=supplier_id, warehouse_id=warehouse_id)

    try:
        purchase_return = PurchaseReturn(
            return_number=_new_purchase_return_number(),
            supplier_id=supplier_id,
            warehouse_id=warehouse_id,
            status=PurchaseReturnStatus.DRAFT,
            created_by=created_by,
        )
        db.add(purchase_return)
        db.flush()

        for line in lines:
            product_id = int(line["product_id"])
            batch_id = int(line["batch_id"])
            quantity = _as_decimal(line["quantity"])
            unit_cost = _as_decimal(line["unit_cost"])

            _assert_product_exists(db, product_id)
            _assert_batch_exists_for_product(db, batch_id=batch_id, product_id=product_id)

            purchase_return.lines.append(
                PurchaseReturnLine(
                    product_id=product_id,
                    batch_id=batch_id,
                    quantity=quantity,
                    unit_cost=unit_cost,
                )
            )

        _add_audit_log(
            db,
            entity_type="PURCHASE_RETURN",
            entity_id=purchase_return.id,
            action="CREATE",
            performed_by=created_by,
            metadata={"return_number": purchase_return.return_number},
        )
        _commit_with_tenant_context(db)
    except Exception:
        db.rollback()
        raise

    return _get_purchase_return_with_lines(db, purchase_return.id)  # type: ignore[return-value]


def approve_po(db: Session, po_id: int, user_id: int) -> PurchaseOrder:
    po = _get_po_with_lines(db, po_id)
    if not po:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Purchase order not found",
            status_code=404,
        )

    PurchaseStateMachine.validate_po_transition(po.status, PurchaseOrderStatus.APPROVED)

    if not po.lines:
        _raise_purchase_error(
            error_code="INVALID_STATE",
            message="Cannot approve a purchase order without lines",
            status_code=409,
        )

    po.status = PurchaseOrderStatus.APPROVED
    _add_audit_log(
        db,
        entity_type="PO",
        entity_id=po.id,
        action="APPROVE",
        performed_by=user_id,
        metadata={"po_number": po.po_number},
    )

    try:
        _commit_with_tenant_context(db)
    except Exception:
        db.rollback()
        raise

    return _get_po_with_lines(db, po.id)  # type: ignore[return-value]


def _resolve_batch_for_grn_line(
    db: Session,
    *,
    product_id: int,
    batch_id: int | None,
    batch_no: str | None,
    expiry_date,
) -> Batch:
    if batch_id is not None:
        batch = db.get(Batch, batch_id)
        if not batch:
            _raise_purchase_error(
                error_code="BATCH_REQUIRED",
                message="Provided batch_id does not exist",
                status_code=400,
            )
        if batch.product_id != product_id:
            _raise_purchase_error(
                error_code="BATCH_REQUIRED",
                message="Provided batch does not belong to the selected product",
                status_code=400,
            )
        if expiry_date and expiry_date != batch.expiry_date:
            _raise_purchase_error(
                error_code="BATCH_REQUIRED",
                message="Provided expiry_date does not match selected batch",
                status_code=400,
            )
        return batch

    if not batch_no:
        _raise_purchase_error(
            error_code="BATCH_REQUIRED",
            message="Batch is required: provide batch_id or batch_no",
            status_code=400,
        )

    if not expiry_date:
        _raise_purchase_error(
            error_code="BATCH_REQUIRED",
            message="Expiry date is required for medical batch receipt",
            status_code=400,
        )

    stmt = (
        select(Batch)
        .where(Batch.product_id == product_id)
        .where(Batch.batch_no == batch_no)
        .where(Batch.expiry_date == expiry_date)
    )
    existing_batch = db.execute(stmt).scalar_one_or_none()
    if existing_batch:
        return existing_batch

    batch = Batch(product_id=product_id, batch_no=batch_no, expiry_date=expiry_date)
    db.add(batch)
    db.flush()
    return batch


def create_grn_from_po(db: Session, po_id: int, payload: GRNCreateFromPO, created_by: int) -> GRN:
    po = _get_po_with_lines(db, po_id)
    if not po:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Purchase order not found",
            status_code=404,
        )
    _assert_po_receivable(po)

    if payload.supplier_id is not None and payload.supplier_id != po.supplier_id:
        _raise_purchase_error(
            error_code="SUPPLIER_MISMATCH",
            message="GRN supplier does not match purchase order supplier",
            status_code=400,
        )

    if payload.warehouse_id is not None and payload.warehouse_id != po.warehouse_id:
        _raise_purchase_error(
            error_code="WAREHOUSE_MISMATCH",
            message="GRN warehouse does not match purchase order warehouse",
            status_code=400,
        )

    if not payload.lines:
        _raise_purchase_error(
            error_code="INVALID_STATE",
            message="GRN must include at least one line",
            status_code=400,
        )

    po_lines_by_id = {line.id: line for line in po.lines}
    seen_po_lines: set[int] = set()

    try:
        grn = GRN(
            grn_number=_new_grn_number(),
            purchase_order_id=po.id,
            supplier_id=po.supplier_id,
            warehouse_id=po.warehouse_id,
            status=GrnStatus.DRAFT,
            received_date=payload.received_date,
            created_by=created_by,
        )
        db.add(grn)
        db.flush()

        for line_payload in payload.lines:
            if line_payload.po_line_id in seen_po_lines:
                _raise_purchase_error(
                    error_code="INVALID_STATE",
                    message="Duplicate po_line_id in GRN lines",
                    status_code=400,
                )
            seen_po_lines.add(line_payload.po_line_id)

            po_line = po_lines_by_id.get(line_payload.po_line_id)
            if not po_line:
                _raise_purchase_error(
                    error_code="INVALID_STATE",
                    message="GRN line references a PO line from a different purchase order",
                    status_code=409,
                )

            remaining_qty = _as_decimal(po_line.ordered_qty) - _as_decimal(po_line.received_qty)
            received_qty = _as_decimal(line_payload.received_qty)
            if received_qty <= 0:
                _raise_purchase_error(
                    error_code="INVALID_STATE",
                    message="Received quantity must be greater than zero",
                    status_code=400,
                )
            if received_qty > remaining_qty:
                _raise_purchase_error(
                    error_code="OVER_RECEIPT",
                    message="Cannot receive more than remaining quantity",
                    status_code=400,
                )

            free_qty = _as_decimal(line_payload.free_qty)
            if free_qty < 0:
                _raise_purchase_error(
                    error_code="INVALID_STATE",
                    message="Free quantity cannot be negative",
                    status_code=400,
                )

            batch = _resolve_batch_for_grn_line(
                db,
                product_id=po_line.product_id,
                batch_id=line_payload.batch_id,
                batch_no=line_payload.batch_no,
                expiry_date=line_payload.expiry_date,
            )

            grn.lines.append(
                GRNLine(
                    po_line_id=po_line.id,
                    product_id=po_line.product_id,
                    batch_id=batch.id,
                    received_qty=received_qty,
                    free_qty=free_qty,
                    unit_cost=line_payload.unit_cost or po_line.unit_cost,
                    expiry_date=batch.expiry_date,
                )
            )

        _add_audit_log(
            db,
            entity_type="GRN",
            entity_id=grn.id,
            action="CREATE",
            performed_by=created_by,
            metadata={"grn_number": grn.grn_number, "purchase_order_id": po.id},
        )
        _commit_with_tenant_context(db)
    except Exception:
        db.rollback()
        raise

    return _get_grn_with_lines(db, grn.id)  # type: ignore[return-value]


def post_grn(db: Session, grn_id: int, user_id: int) -> GRN:
    try:
        grn = _get_grn_with_lines(db, grn_id, lock=True)
        if not grn:
            _raise_purchase_error(
                error_code="NOT_FOUND",
                message="GRN not found",
                status_code=404,
            )
        PurchaseStateMachine.validate_grn_transition(grn.status, GrnStatus.POSTED)
        if not grn.lines:
            _raise_purchase_error(
                error_code="INVALID_STATE",
                message="Cannot post an empty GRN",
                status_code=409,
            )

        po = _get_po_with_lines(db, grn.purchase_order_id, lock=True)
        if not po:
            _raise_purchase_error(
                error_code="NOT_FOUND",
                message="Purchase order not found",
                status_code=404,
            )
        _assert_po_receivable(po)
        if grn.warehouse_id != po.warehouse_id:
            _raise_purchase_error(
                error_code="WAREHOUSE_MISMATCH",
                message="GRN warehouse does not match purchase order warehouse",
                status_code=400,
            )
        if grn.supplier_id != po.supplier_id:
            _raise_purchase_error(
                error_code="SUPPLIER_MISMATCH",
                message="GRN supplier does not match purchase order supplier",
                status_code=400,
            )

        po_lines_by_id = {line.id: line for line in po.lines}

        for line in grn.lines:
            po_line = po_lines_by_id.get(line.po_line_id)
            if not po_line or po_line.purchase_order_id != po.id:
                _raise_purchase_error(
                    error_code="INVALID_STATE",
                    message="GRN line references a PO line from a different purchase order",
                    status_code=409,
                )

            remaining_qty = _as_decimal(po_line.ordered_qty) - _as_decimal(po_line.received_qty)
            if _as_decimal(line.received_qty) > remaining_qty:
                _raise_purchase_error(
                    error_code="OVER_RECEIPT",
                    message="Cannot receive more than remaining quantity",
                    status_code=400,
                )

            total_stock_qty = _as_decimal(line.received_qty) + _as_decimal(line.free_qty)
            if total_stock_qty <= 0:
                _raise_purchase_error(
                    error_code="INVALID_STATE",
                    message="Invalid GRN line quantity",
                    status_code=400,
                )

            stock_in(
                db,
                warehouse_id=grn.warehouse_id,
                product_id=line.product_id,
                batch_id=line.batch_id,
                qty=total_stock_qty,
                reason=InventoryReason.PURCHASE_GRN,
                created_by=user_id,
                ref_type="GRN",
                ref_id=grn.grn_number,
                commit=False,
            )

            po_line.received_qty = _as_decimal(po_line.received_qty) + _as_decimal(
                line.received_qty
            )

        next_po_status = (
            PurchaseOrderStatus.CLOSED
            if all(
                _as_decimal(po_line.received_qty) >= _as_decimal(po_line.ordered_qty)
                for po_line in po.lines
            )
            else PurchaseOrderStatus.PARTIALLY_RECEIVED
        )
        PurchaseStateMachine.validate_po_transition(po.status, next_po_status)
        po.status = next_po_status

        grn.status = GrnStatus.POSTED
        grn.posted_at = datetime.now(timezone.utc)
        grn.posted_by = user_id

        _add_audit_log(
            db,
            entity_type="GRN",
            entity_id=grn.id,
            action="POST",
            performed_by=user_id,
            metadata={"grn_number": grn.grn_number, "purchase_order_id": po.id},
        )
        _commit_with_tenant_context(db)
    except Exception:
        db.rollback()
        raise

    return _get_grn_with_lines(db, grn_id)  # type: ignore[return-value]


def post_purchase_return(db: Session, purchase_return_id: int, user_id: int) -> PurchaseReturn:
    try:
        purchase_return = _get_purchase_return_with_lines(db, purchase_return_id, lock=True)
        if not purchase_return:
            _raise_purchase_error(
                error_code="NOT_FOUND",
                message="Purchase return not found",
                status_code=404,
            )

        if purchase_return.status == PurchaseReturnStatus.POSTED:
            _raise_purchase_error(
                error_code="INVALID_STATE",
                message="Purchase return already posted",
                status_code=409,
            )
        if purchase_return.status == PurchaseReturnStatus.CANCELLED:
            _raise_purchase_error(
                error_code="INVALID_STATE",
                message="Cancelled purchase return cannot be posted",
                status_code=409,
            )
        if not purchase_return.lines:
            _raise_purchase_error(
                error_code="INVALID_STATE",
                message="Cannot post an empty purchase return",
                status_code=409,
            )
        if purchase_return.credit_note is not None:
            _raise_purchase_error(
                error_code="INVALID_STATE",
                message="Purchase credit note already exists for this return",
                status_code=409,
            )

        total_amount = sum(
            (_as_decimal(line.quantity) * _as_decimal(line.unit_cost))
            for line in purchase_return.lines
        )

        purchase_return.status = PurchaseReturnStatus.POSTED
        purchase_return.posted_at = datetime.now(timezone.utc)
        purchase_return.posted_by = user_id

        credit_note = PurchaseCreditNote(
            credit_note_number=_new_credit_note_number(),
            supplier_id=purchase_return.supplier_id,
            warehouse_id=purchase_return.warehouse_id,
            purchase_return_id=purchase_return.id,
            total_amount=total_amount,
            status=PurchaseCreditNoteStatus.GENERATED,
            created_by=user_id,
        )
        db.add(credit_note)
        db.flush()

        _add_audit_log(
            db,
            entity_type="PURCHASE_RETURN",
            entity_id=purchase_return.id,
            action="POST",
            performed_by=user_id,
            metadata={"return_number": purchase_return.return_number},
        )
        _add_audit_log(
            db,
            entity_type="PURCHASE_CREDIT_NOTE",
            entity_id=credit_note.id,
            action="GENERATE",
            performed_by=user_id,
            metadata={
                "purchase_return_id": purchase_return.id,
                "credit_note_number": credit_note.credit_note_number,
            },
        )
        _commit_with_tenant_context(db)
    except Exception:
        db.rollback()
        raise

    return _get_purchase_return_with_lines(db, purchase_return_id)  # type: ignore[return-value]
