from __future__ import annotations

import logging
from datetime import date, datetime, timezone
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
    GRNBatchLine,
    GRNLine,
    PurchaseCreditNote,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from app.models.purchase_bill import PurchaseBill, PurchaseBillLine
from app.models.stock_provenance import StockSourceProvenance
from app.models.warehouse import Warehouse
from app.schemas.purchase import (
    GRNBatchLineCreate,
    GRNCreateFromBill,
    GRNCreateFromPO,
    GRNUpdate,
    PurchaseOrderCreate,
    PurchaseOrderUpdate,
)
from app.services.audit import snapshot_model, write_audit_log
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
        .options(
            selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.product),
            selectinload(PurchaseOrder.supplier),
            selectinload(PurchaseOrder.warehouse),
        )
    )
    if lock:
        stmt = stmt.with_for_update()
    return db.execute(stmt).scalar_one_or_none()


def _get_grn_with_lines(db: Session, grn_id: int, lock: bool = False) -> GRN | None:
    stmt = (
        select(GRN)
        .where(GRN.id == grn_id)
        .options(
            selectinload(GRN.purchase_order),
            selectinload(GRN.purchase_bill),
            selectinload(GRN.supplier),
            selectinload(GRN.warehouse),
            selectinload(GRN.creator),
            selectinload(GRN.poster),
            selectinload(GRN.lines).selectinload(GRNLine.product),
            selectinload(GRN.lines).selectinload(GRNLine.po_line),
            selectinload(GRN.lines).selectinload(GRNLine.purchase_bill_line),
            selectinload(GRN.lines).selectinload(GRNLine.batch_lines).selectinload(GRNBatchLine.batch),
        )
    )
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


def _get_company_state(db: Session) -> str | None:
    if not _company_settings_table_exists(db):
        return None
    settings = db.query(CompanySettings).filter(CompanySettings.id == 1).first()
    if settings is None or not settings.state:
        return None
    normalized_state = settings.state.strip()
    return normalized_state or None


def _determine_purchase_tax_context(
    db: Session,
    *,
    supplier: Party,
    requires_tax_context: bool,
) -> dict[str, Decimal | str | None]:
    supplier_gstin = normalize_and_validate_gstin(supplier.gstin) if supplier.gstin else None
    company_gstin = _get_company_gstin(db)
    supplier_state = derive_state_from_gstin(supplier_gstin) if supplier_gstin else None
    company_state = derive_state_from_gstin(company_gstin) if company_gstin else None

    if supplier_state is None and supplier.state:
        normalized_state = supplier.state.strip()
        supplier_state = normalized_state or None
    if company_state is None:
        company_state = _get_company_state(db)

    if requires_tax_context:
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

    if requires_tax_context and company_state and supplier_state:
        if company_state == supplier_state:
            tax_type = "INTRA_STATE"
        else:
            tax_type = "INTER_STATE"

    return {
        "tax_type": tax_type,
        "supplier_gstin": supplier_gstin,
        "supplier_state": supplier_state,
        "company_gstin": company_gstin,
        "company_state": company_state,
        "cgst_percent": cgst_percent,
        "sgst_percent": sgst_percent,
        "igst_percent": igst_percent,
    }


def _calculate_po_financials(
    db: Session,
    *,
    payload: PurchaseOrderCreate,
    supplier: Party,
) -> dict[str, Decimal | str | list[dict[str, Decimal]]]:
    discount_percent = _money(payload.discount_percent)
    adjustment = _money(payload.adjustment)
    fallback_gst_percent = _money(payload.gst_percent)
    product_ids = {line.product_id for line in payload.lines}
    products = (
        db.query(Product)
        .filter(Product.id.in_(product_ids))
        .all()
    )
    products_by_id = {product.id: product for product in products}
    line_gst_percents: dict[int, Decimal] = {}

    for line in payload.lines:
        product = products_by_id.get(line.product_id)
        if product is None:
            _raise_purchase_error(
                error_code="NOT_FOUND",
                message=f"Product not found: {line.product_id}",
                status_code=404,
            )

        product_gst_percent = _money(product.gst_rate or Decimal("0.00"))
        line_gst_percents[line.product_id] = (
            product_gst_percent if product_gst_percent > 0 else fallback_gst_percent
        )

    requires_tax_context = any(gst_percent > 0 for gst_percent in line_gst_percents.values())

    tax_context = _determine_purchase_tax_context(
        db,
        supplier=supplier,
        requires_tax_context=requires_tax_context,
    )

    line_financials: list[dict[str, Decimal]] = []
    subtotal = Decimal("0.00")
    discount_amount = Decimal("0.00")
    taxable_value = Decimal("0.00")
    cgst_amount = Decimal("0.00")
    sgst_amount = Decimal("0.00")
    igst_amount = Decimal("0.00")
    distinct_line_gst_percents: set[Decimal] = set()

    for line in payload.lines:
        line_gst_percent = line_gst_percents[line.product_id]
        line_subtotal = _money(
            _as_decimal(line.ordered_qty) * _as_decimal(line.unit_cost or Decimal("0"))
        )
        line_discount_amount = _money((line_subtotal * discount_percent) / Decimal("100"))
        line_taxable_value = _money(line_subtotal - line_discount_amount)
        line_cgst_percent = Decimal("0.00")
        line_sgst_percent = Decimal("0.00")
        line_igst_percent = Decimal("0.00")

        if line_gst_percent > 0:
            if str(tax_context["tax_type"]) == "INTRA_STATE":
                line_cgst_percent = _money(line_gst_percent / Decimal("2"))
                line_sgst_percent = _money(line_gst_percent / Decimal("2"))
            elif str(tax_context["tax_type"]) == "INTER_STATE":
                line_igst_percent = line_gst_percent

        line_cgst_amount = _money((line_taxable_value * line_cgst_percent) / Decimal("100"))
        line_sgst_amount = _money((line_taxable_value * line_sgst_percent) / Decimal("100"))
        line_igst_amount = _money((line_taxable_value * line_igst_percent) / Decimal("100"))
        line_tax_amount = _money(line_cgst_amount + line_sgst_amount + line_igst_amount)
        line_total = _money(line_taxable_value + line_tax_amount)

        subtotal += line_subtotal
        discount_amount += line_discount_amount
        taxable_value += line_taxable_value
        cgst_amount += line_cgst_amount
        sgst_amount += line_sgst_amount
        igst_amount += line_igst_amount
        if line_gst_percent > 0:
            distinct_line_gst_percents.add(line_gst_percent)
        line_financials.append(
            {
                "discount_amount": line_discount_amount,
                "taxable_value": line_taxable_value,
                "gst_percent": line_gst_percent,
                "cgst_percent": line_cgst_percent,
                "sgst_percent": line_sgst_percent,
                "igst_percent": line_igst_percent,
                "cgst_amount": line_cgst_amount,
                "sgst_amount": line_sgst_amount,
                "igst_amount": line_igst_amount,
                "tax_amount": line_tax_amount,
                "line_total": line_total,
            }
        )

    subtotal = _money(subtotal)
    discount_amount = _money(discount_amount)
    taxable_value = _money(taxable_value)
    cgst_amount = _money(cgst_amount)
    sgst_amount = _money(sgst_amount)
    igst_amount = _money(igst_amount)
    final_total = _money(taxable_value + cgst_amount + sgst_amount + igst_amount + adjustment)
    header_gst_percent = distinct_line_gst_percents.pop() if len(distinct_line_gst_percents) == 1 else Decimal("0.00")
    header_cgst_percent = _money(header_gst_percent / Decimal("2")) if str(tax_context["tax_type"]) == "INTRA_STATE" and header_gst_percent > 0 else Decimal("0.00")
    header_sgst_percent = header_cgst_percent
    header_igst_percent = header_gst_percent if str(tax_context["tax_type"]) == "INTER_STATE" and header_gst_percent > 0 else Decimal("0.00")

    if final_total < 0:
        _raise_purchase_error(
            error_code="VALIDATION_ERROR",
            message="Final total cannot be negative",
            status_code=400,
            details={"field": "final_total"},
        )

    return {
        "tax_type": str(tax_context["tax_type"]),
        "subtotal": subtotal,
        "discount_percent": discount_percent,
        "discount_amount": discount_amount,
        "taxable_value": taxable_value,
        "gst_percent": header_gst_percent,
        "cgst_percent": header_cgst_percent,
        "sgst_percent": header_sgst_percent,
        "igst_percent": header_igst_percent,
        "cgst_amount": cgst_amount,
        "sgst_amount": sgst_amount,
        "igst_amount": igst_amount,
        "adjustment": adjustment,
        "final_total": final_total,
        "line_financials": line_financials,
        "supplier_gstin": tax_context["supplier_gstin"],
        "supplier_state": tax_context["supplier_state"],
        "company_gstin": tax_context["company_gstin"],
        "company_state": tax_context["company_state"],
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


def _upsert_stock_source_provenance(
    db: Session,
    *,
    ledger_id: int,
    supplier_id: int,
    purchase_order_id: int,
    purchase_bill_id: int | None,
    grn_id: int,
    grn_line_id: int,
    grn_batch_line_id: int,
    warehouse_id: int,
    product_id: int,
    batch_id: int,
    batch_no: str,
    expiry_date: date,
    inward_date: date,
    received_qty: Decimal,
    free_qty: Decimal,
    unit_cost_snapshot: Decimal | None,
) -> StockSourceProvenance:
    provenance = (
        db.query(StockSourceProvenance)
        .filter(StockSourceProvenance.ledger_id == ledger_id)
        .first()
    )
    if provenance is None:
        provenance = StockSourceProvenance(ledger_id=ledger_id)
        db.add(provenance)

    provenance.supplier_id = supplier_id
    provenance.purchase_order_id = purchase_order_id
    provenance.purchase_bill_id = purchase_bill_id
    provenance.grn_id = grn_id
    provenance.grn_line_id = grn_line_id
    provenance.grn_batch_line_id = grn_batch_line_id
    provenance.warehouse_id = warehouse_id
    provenance.product_id = product_id
    provenance.batch_id = batch_id
    provenance.batch_no = batch_no
    provenance.expiry_date = expiry_date
    provenance.inward_date = inward_date
    provenance.received_qty = received_qty
    provenance.free_qty = free_qty
    provenance.unit_cost_snapshot = unit_cost_snapshot
    db.flush()
    return provenance


def _refresh_grn_purchase_bill_provenance(
    db: Session,
    *,
    grn: GRN,
    user_id: int,
) -> None:
    provenance_rows = (
        db.query(StockSourceProvenance)
        .filter(StockSourceProvenance.grn_id == grn.id)
        .all()
    )
    if not provenance_rows:
        return

    changed_ledger_ids: list[int] = []
    for row in provenance_rows:
        if row.purchase_bill_id == grn.purchase_bill_id:
            continue
        before_snapshot = snapshot_model(row, fields=("id", "purchase_bill_id", "grn_id", "ledger_id"))
        row.purchase_bill_id = grn.purchase_bill_id
        changed_ledger_ids.append(row.ledger_id)
        write_audit_log(
            db,
            module="Inventory",
            action="UPDATE",
            entity_type="STOCK_SOURCE_PROVENANCE",
            entity_id=row.id,
            performed_by=user_id,
            summary=f"Updated stock provenance for GRN {grn.grn_number}",
            source_screen="Purchase / GRN / Attach Bill",
            before_snapshot=before_snapshot,
            after_snapshot=snapshot_model(row, fields=("id", "purchase_bill_id", "grn_id", "ledger_id")),
            metadata={
                "grn_id": grn.id,
                "purchase_bill_id": grn.purchase_bill_id,
                "ledger_id": row.ledger_id,
            },
        )
    if changed_ledger_ids:
        logger.info(
            "Updated GRN stock provenance purchase bill linkage",
            extra={
                "grn_id": grn.id,
                "grn_number": grn.grn_number,
                "purchase_bill_id": grn.purchase_bill_id,
                "ledger_ids": changed_ledger_ids,
            },
        )


def _add_audit_log(
    db: Session,
    *,
    entity_type: str,
    entity_id: int,
    action: str,
    performed_by: int,
    metadata: dict | None = None,
    before_snapshot: dict | None = None,
    after_snapshot: dict | None = None,
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
        before_snapshot=before_snapshot,
        after_snapshot=after_snapshot,
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
        logger.info(
            "Calculated purchase order tax context",
            extra={
                "supplier_id": payload.supplier_id,
                "warehouse_id": payload.warehouse_id,
                "created_by": created_by,
                "tax_mode": str(financials["tax_type"]),
                "company_gstin": financials["company_gstin"],
                "company_state": financials["company_state"],
                "supplier_gstin": financials["supplier_gstin"],
                "supplier_state": financials["supplier_state"],
                "summary": {
                    "subtotal": str(financials["subtotal"]),
                    "discount_amount": str(financials["discount_amount"]),
                    "taxable_value": str(financials["taxable_value"]),
                    "gst_percent": str(financials["gst_percent"]),
                    "cgst_amount": str(financials["cgst_amount"]),
                    "sgst_amount": str(financials["sgst_amount"]),
                    "igst_amount": str(financials["igst_amount"]),
                    "adjustment": str(financials["adjustment"]),
                    "final_total": str(financials["final_total"]),
                },
                "line_payload": [
                    {
                        "product_id": line.product_id,
                        "ordered_qty": str(line.ordered_qty),
                        "unit_cost": str(line.unit_cost) if line.unit_cost is not None else None,
                        "free_qty": str(line.free_qty),
                    }
                    for line in payload.lines
                ],
            },
        )
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

        for index, line in enumerate(payload.lines):
            _assert_product_exists(db, line.product_id)
            line_financial = financials["line_financials"][index]
            po.lines.append(
                PurchaseOrderLine(
                    product_id=line.product_id,
                    ordered_qty=_as_decimal(line.ordered_qty),
                    received_qty=Decimal("0"),
                    unit_cost=line.unit_cost,
                    free_qty=_as_decimal(line.free_qty),
                    discount_amount=_as_decimal(line_financial["discount_amount"]),
                    taxable_value=_as_decimal(line_financial["taxable_value"]),
                    gst_percent=_as_decimal(line_financial["gst_percent"]),
                    cgst_percent=_as_decimal(line_financial["cgst_percent"]),
                    sgst_percent=_as_decimal(line_financial["sgst_percent"]),
                    igst_percent=_as_decimal(line_financial["igst_percent"]),
                    cgst_amount=_as_decimal(line_financial["cgst_amount"]),
                    sgst_amount=_as_decimal(line_financial["sgst_amount"]),
                    igst_amount=_as_decimal(line_financial["igst_amount"]),
                    tax_amount=_as_decimal(line_financial["tax_amount"]),
                    line_total=_as_decimal(line_financial["line_total"]),
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
            after_snapshot=snapshot_model(po),
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
                "discount_percent": str(payload.discount_percent),
                "gst_percent": str(payload.gst_percent),
                "adjustment": str(payload.adjustment),
                "lines": [
                    {
                        "product_id": line.product_id,
                        "ordered_qty": str(line.ordered_qty),
                        "unit_cost": str(line.unit_cost) if line.unit_cost is not None else None,
                        "free_qty": str(line.free_qty),
                    }
                    for line in payload.lines
                ],
            },
        )
        raise AppException(
            error_code="PURCHASE_ORDER_CREATE_FAILED",
            message="Failed to create purchase order",
            status_code=500,
        )

    return _get_po_with_lines(db, po.id)  # type: ignore[return-value]


def update_po(db: Session, po_id: int, payload: PurchaseOrderUpdate, user_id: int) -> PurchaseOrder:
    po = _get_po_with_lines(db, po_id, lock=True)
    if not po:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Purchase order not found",
            status_code=404,
        )
    if po.status != PurchaseOrderStatus.DRAFT:
        _raise_purchase_error(
            error_code="INVALID_STATE",
            message="Only draft purchase orders can be edited",
            status_code=409,
        )
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

    before_snapshot = snapshot_model(po)

    try:
        financials = _calculate_po_financials(db, payload=payload, supplier=supplier)
        po.supplier_id = payload.supplier_id
        po.warehouse_id = payload.warehouse_id
        po.order_date = payload.order_date
        po.expected_date = payload.expected_date
        po.notes = payload.notes
        po.tax_type = str(financials["tax_type"])
        po.subtotal = _as_decimal(financials["subtotal"])
        po.discount_percent = _as_decimal(financials["discount_percent"])
        po.discount_amount = _as_decimal(financials["discount_amount"])
        po.taxable_value = _as_decimal(financials["taxable_value"])
        po.gst_percent = _as_decimal(financials["gst_percent"])
        po.cgst_percent = _as_decimal(financials["cgst_percent"])
        po.sgst_percent = _as_decimal(financials["sgst_percent"])
        po.igst_percent = _as_decimal(financials["igst_percent"])
        po.cgst_amount = _as_decimal(financials["cgst_amount"])
        po.sgst_amount = _as_decimal(financials["sgst_amount"])
        po.igst_amount = _as_decimal(financials["igst_amount"])
        po.adjustment = _as_decimal(financials["adjustment"])
        po.final_total = _as_decimal(financials["final_total"])
        po.lines.clear()
        db.flush()

        for index, line in enumerate(payload.lines):
            _assert_product_exists(db, line.product_id)
            line_financial = financials["line_financials"][index]
            po.lines.append(
                PurchaseOrderLine(
                    product_id=line.product_id,
                    ordered_qty=_as_decimal(line.ordered_qty),
                    received_qty=Decimal("0"),
                    unit_cost=line.unit_cost,
                    free_qty=_as_decimal(line.free_qty),
                    discount_amount=_as_decimal(line_financial["discount_amount"]),
                    taxable_value=_as_decimal(line_financial["taxable_value"]),
                    gst_percent=_as_decimal(line_financial["gst_percent"]),
                    cgst_percent=_as_decimal(line_financial["cgst_percent"]),
                    sgst_percent=_as_decimal(line_financial["sgst_percent"]),
                    igst_percent=_as_decimal(line_financial["igst_percent"]),
                    cgst_amount=_as_decimal(line_financial["cgst_amount"]),
                    sgst_amount=_as_decimal(line_financial["sgst_amount"]),
                    igst_amount=_as_decimal(line_financial["igst_amount"]),
                    tax_amount=_as_decimal(line_financial["tax_amount"]),
                    line_total=_as_decimal(line_financial["line_total"]),
                    line_notes=line.line_notes,
                )
            )

        _add_audit_log(
            db,
            entity_type="PO",
            entity_id=po.id,
            action="UPDATE",
            performed_by=user_id,
            metadata={"po_number": po.po_number},
            before_snapshot=before_snapshot,
            after_snapshot=snapshot_model(po),
        )
        _commit_with_tenant_context(db)
    except AppException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception(
            "Purchase order update failed",
            extra={
                "po_id": po_id,
                "updated_by": user_id,
                "supplier_id": payload.supplier_id,
                "warehouse_id": payload.warehouse_id,
                "line_count": len(payload.lines),
            },
        )
        raise AppException(
            error_code="PURCHASE_ORDER_UPDATE_FAILED",
            message="Failed to update purchase order",
            status_code=500,
        )

    return _get_po_with_lines(db, po.id)  # type: ignore[return-value]


def cancel_po(db: Session, po_id: int, user_id: int) -> PurchaseOrder:
    po = _get_po_with_lines(db, po_id, lock=True)
    if not po:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Purchase order not found",
            status_code=404,
        )
    if po.status != PurchaseOrderStatus.DRAFT:
        _raise_purchase_error(
            error_code="INVALID_STATE",
            message="Only draft purchase orders can be cancelled",
            status_code=409,
        )

    before_snapshot = snapshot_model(po)
    po.status = PurchaseOrderStatus.CANCELLED
    _add_audit_log(
        db,
        entity_type="PO",
        entity_id=po.id,
        action="CANCEL",
        performed_by=user_id,
        metadata={"po_number": po.po_number},
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(po),
    )

    try:
        _commit_with_tenant_context(db)
    except Exception:
        db.rollback()
        raise

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


def _get_purchase_bill_with_lines(
    db: Session,
    purchase_bill_id: int,
    lock: bool = False,
) -> PurchaseBill | None:
    stmt = (
        select(PurchaseBill)
        .where(PurchaseBill.id == purchase_bill_id)
        .options(
            selectinload(PurchaseBill.lines).selectinload(PurchaseBillLine.product),
            selectinload(PurchaseBill.supplier),
            selectinload(PurchaseBill.purchase_order),
        )
    )
    if lock:
        stmt = stmt.with_for_update()
    return db.execute(stmt).scalar_one_or_none()


def _normalize_grn_batch_inputs(line_payload) -> list[GRNBatchLineCreate]:
    if getattr(line_payload, "batch_lines", None):
        return list(line_payload.batch_lines)

    return [
        GRNBatchLineCreate(
            batch_id=line_payload.batch_id,
            batch_no=line_payload.batch_no,
            expiry_date=line_payload.expiry_date,
            mfg_date=getattr(line_payload, "mfg_date", None),
            mrp=getattr(line_payload, "mrp", None),
            received_qty=line_payload.received_qty,
            free_qty=line_payload.free_qty,
            unit_cost=line_payload.unit_cost,
            remarks=getattr(line_payload, "remarks", None),
        )
    ]


def _resolve_batch_for_grn_batch(
    db: Session,
    *,
    product_id: int,
    batch_id: int | None,
    batch_no: str | None,
    expiry_date: date | None,
    mfg_date: date | None,
    mrp: Decimal | None,
    create_if_missing: bool,
) -> Batch | None:
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

    if not batch_no or expiry_date is None:
        _raise_purchase_error(
            error_code="BATCH_REQUIRED",
            message="Batch number and expiry date are required",
            status_code=400,
        )

    stmt = (
        select(Batch)
        .where(Batch.product_id == product_id)
        .where(Batch.batch_no == batch_no)
        .where(Batch.expiry_date == expiry_date)
        .where(Batch.mfg_date.is_(mfg_date) if mfg_date is None else Batch.mfg_date == mfg_date)
        .where(Batch.mrp.is_(mrp) if mrp is None else Batch.mrp == mrp)
    )
    existing_batch = db.execute(stmt).scalar_one_or_none()
    if existing_batch:
        return existing_batch
    if not create_if_missing:
        return None

    batch = Batch(
        product_id=product_id,
        batch_no=batch_no,
        expiry_date=expiry_date,
        mfg_date=mfg_date,
        mrp=mrp,
    )
    db.add(batch)
    db.flush()
    return batch


def _validate_bill_matches_po(
    *,
    purchase_bill: PurchaseBill,
    purchase_order: PurchaseOrder,
) -> None:
    if purchase_bill.supplier_id is not None and purchase_bill.supplier_id != purchase_order.supplier_id:
        _raise_purchase_error(
            error_code="SUPPLIER_MISMATCH",
            message="Purchase bill supplier does not match purchase order supplier",
            status_code=400,
        )
    if (
        purchase_bill.purchase_order_id is not None
        and purchase_bill.purchase_order_id != purchase_order.id
    ):
        _raise_purchase_error(
            error_code="PO_MISMATCH",
            message="Purchase bill does not belong to the selected purchase order",
            status_code=400,
        )


def _infer_po_line_for_bill_line(
    po: PurchaseOrder,
    *,
    product_id: int,
    required_qty: Decimal,
) -> PurchaseOrderLine | None:
    for po_line in po.lines:
        if po_line.product_id != product_id:
            continue
        remaining_qty = _as_decimal(po_line.ordered_qty) - _as_decimal(po_line.received_qty)
        if remaining_qty >= required_qty:
            return po_line
    return None


def _build_grn_draft(
    db: Session,
    *,
    grn: GRN,
    po: PurchaseOrder,
    purchase_bill: PurchaseBill | None,
    payload_lines: list,
) -> None:
    po_lines_by_id = {line.id: line for line in po.lines}
    bill_lines_by_id = (
        {line.id: line for line in purchase_bill.lines}
        if purchase_bill is not None
        else {}
    )
    seen_po_lines: set[int] = set()

    grn.lines.clear()
    db.flush()

    for line_payload in payload_lines:
        batch_inputs = _normalize_grn_batch_inputs(line_payload)
        total_received_qty = sum((_as_decimal(batch.received_qty) for batch in batch_inputs), Decimal("0"))
        total_free_qty = sum((_as_decimal(batch.free_qty) for batch in batch_inputs), Decimal("0"))

        if total_received_qty <= 0:
            _raise_purchase_error(
                error_code="INVALID_STATE",
                message="Received quantity must be greater than zero",
                status_code=400,
            )

        po_line = po_lines_by_id.get(line_payload.po_line_id) if line_payload.po_line_id else None
        if po_line is None and purchase_bill is not None and line_payload.purchase_bill_line_id is not None:
            bill_line = bill_lines_by_id.get(line_payload.purchase_bill_line_id)
            if bill_line is not None:
                po_line = _infer_po_line_for_bill_line(
                    po,
                    product_id=bill_line.product_id or 0,
                    required_qty=total_received_qty,
                )
                if po_line is not None:
                    line_payload.po_line_id = po_line.id

        if po_line is None:
            _raise_purchase_error(
                error_code="INVALID_STATE",
                message="GRN line must map to a purchase order line",
                status_code=400,
            )
        if po_line.id in seen_po_lines:
            _raise_purchase_error(
                error_code="INVALID_STATE",
                message="Duplicate purchase order line in GRN",
                status_code=400,
            )
        seen_po_lines.add(po_line.id)

        remaining_qty = _as_decimal(po_line.ordered_qty) - _as_decimal(po_line.received_qty)
        if total_received_qty > remaining_qty:
            _raise_purchase_error(
                error_code="OVER_RECEIPT",
                message="Cannot receive more than remaining quantity",
                status_code=400,
            )

        purchase_bill_line = (
            bill_lines_by_id.get(line_payload.purchase_bill_line_id)
            if line_payload.purchase_bill_line_id is not None
            else None
        )
        if purchase_bill_line is not None and purchase_bill_line.product_id not in (None, po_line.product_id):
            _raise_purchase_error(
                error_code="PRODUCT_MISMATCH",
                message="Purchase bill line product does not match purchase order line product",
                status_code=400,
            )

        product = db.get(Product, po_line.product_id)
        if product is None:
            _raise_purchase_error(
                error_code="NOT_FOUND",
                message=f"Product not found: {po_line.product_id}",
                status_code=404,
            )

        primary_batch = None
        if len(batch_inputs) == 1:
            first_batch = batch_inputs[0]
            primary_batch = _resolve_batch_for_grn_batch(
                db,
                product_id=po_line.product_id,
                batch_id=first_batch.batch_id,
                batch_no=first_batch.batch_no,
                expiry_date=first_batch.expiry_date,
                mfg_date=first_batch.mfg_date,
                mrp=first_batch.mrp,
                create_if_missing=False,
            )

        grn_line = GRNLine(
            po_line_id=po_line.id,
            purchase_bill_line_id=getattr(line_payload, "purchase_bill_line_id", None),
            product_id=po_line.product_id,
            product_name_snapshot=product.name,
            ordered_qty_snapshot=_as_decimal(po_line.ordered_qty),
            billed_qty_snapshot=_as_decimal(purchase_bill_line.qty) if purchase_bill_line is not None else None,
            received_qty_total=total_received_qty,
            free_qty_total=total_free_qty,
            batch_id=primary_batch.id if primary_batch is not None else None,
            received_qty=total_received_qty,
            free_qty=total_free_qty,
            unit_cost=(
                batch_inputs[0].unit_cost
                if batch_inputs[0].unit_cost is not None
                else line_payload.unit_cost or po_line.unit_cost
            ),
            expiry_date=batch_inputs[0].expiry_date if len(batch_inputs) == 1 else None,
            remarks=getattr(line_payload, "remarks", None),
        )

        for batch_input in batch_inputs:
            existing_batch = _resolve_batch_for_grn_batch(
                db,
                product_id=po_line.product_id,
                batch_id=batch_input.batch_id,
                batch_no=batch_input.batch_no,
                expiry_date=batch_input.expiry_date,
                mfg_date=batch_input.mfg_date,
                mrp=batch_input.mrp,
                create_if_missing=False,
            )
            grn_line.batch_lines.append(
                GRNBatchLine(
                    batch_no=batch_input.batch_no or (existing_batch.batch_no if existing_batch else ""),
                    expiry_date=batch_input.expiry_date,
                    mfg_date=batch_input.mfg_date,
                    mrp=batch_input.mrp,
                    received_qty=_as_decimal(batch_input.received_qty),
                    free_qty=_as_decimal(batch_input.free_qty),
                    unit_cost=batch_input.unit_cost or line_payload.unit_cost or po_line.unit_cost,
                    batch_id=existing_batch.id if existing_batch is not None else None,
                    remarks=batch_input.remarks,
                )
            )

        grn.lines.append(grn_line)


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

    purchase_bill = None
    if payload.purchase_bill_id is not None:
        purchase_bill = _get_purchase_bill_with_lines(db, payload.purchase_bill_id)
        if purchase_bill is None:
            _raise_purchase_error(
                error_code="NOT_FOUND",
                message="Purchase bill not found",
                status_code=404,
            )
        _validate_bill_matches_po(purchase_bill=purchase_bill, purchase_order=po)

    try:
        grn = GRN(
            grn_number=_new_grn_number(),
            purchase_order_id=po.id,
            purchase_bill_id=payload.purchase_bill_id,
            supplier_id=po.supplier_id,
            warehouse_id=po.warehouse_id,
            status=GrnStatus.DRAFT,
            received_date=payload.received_date,
            remarks=payload.remarks,
            created_by=created_by,
        )
        db.add(grn)
        db.flush()
        _build_grn_draft(
            db,
            grn=grn,
            po=po,
            purchase_bill=purchase_bill,
            payload_lines=payload.lines,
        )
        _add_audit_log(
            db,
            entity_type="GRN",
            entity_id=grn.id,
            action="CREATE",
            performed_by=created_by,
            metadata={
                "grn_number": grn.grn_number,
                "purchase_order_id": po.id,
                "purchase_bill_id": payload.purchase_bill_id,
                "batch_row_count": sum(len(line.batch_lines) for line in grn.lines),
            },
            after_snapshot=snapshot_model(grn),
        )
        _commit_with_tenant_context(db)
    except Exception:
        db.rollback()
        raise

    return _get_grn_with_lines(db, grn.id)  # type: ignore[return-value]


def create_grn_from_bill(
    db: Session,
    purchase_bill_id: int,
    payload: GRNCreateFromBill,
    created_by: int,
) -> GRN:
    purchase_bill = _get_purchase_bill_with_lines(db, purchase_bill_id)
    if purchase_bill is None:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Purchase bill not found",
            status_code=404,
        )
    if purchase_bill.purchase_order_id is None and payload.purchase_order_id is None:
        _raise_purchase_error(
            error_code="PO_REQUIRED",
            message="Purchase bill must be linked to a purchase order before GRN creation",
            status_code=400,
        )
    po_id = payload.purchase_order_id or purchase_bill.purchase_order_id
    po = _get_po_with_lines(db, int(po_id))
    if po is None:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Purchase order not found",
            status_code=404,
        )
    _assert_po_receivable(po)
    _validate_bill_matches_po(purchase_bill=purchase_bill, purchase_order=po)

    create_payload = GRNCreateFromPO(
        supplier_id=payload.supplier_id,
        warehouse_id=payload.warehouse_id,
        purchase_bill_id=purchase_bill.id,
        received_date=payload.received_date,
        remarks=payload.remarks,
        lines=payload.lines,
    )
    return create_grn_from_po(db, po.id, create_payload, created_by)


def update_grn(db: Session, grn_id: int, payload: GRNUpdate, user_id: int) -> GRN:
    grn = _get_grn_with_lines(db, grn_id, lock=True)
    if grn is None:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="GRN not found",
            status_code=404,
        )
    if grn.status != GrnStatus.DRAFT:
        _raise_purchase_error(
            error_code="INVALID_STATE",
            message="Only draft GRNs can be edited",
            status_code=409,
        )

    po = _get_po_with_lines(db, grn.purchase_order_id, lock=True)
    if po is None:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Purchase order not found",
            status_code=404,
        )
    _assert_po_receivable(po)

    purchase_bill = None
    if payload.purchase_bill_id is not None:
        purchase_bill = _get_purchase_bill_with_lines(db, payload.purchase_bill_id)
        if purchase_bill is None:
            _raise_purchase_error(
                error_code="NOT_FOUND",
                message="Purchase bill not found",
                status_code=404,
            )
        _validate_bill_matches_po(purchase_bill=purchase_bill, purchase_order=po)

    before_snapshot = snapshot_model(grn)
    try:
        grn.purchase_bill_id = payload.purchase_bill_id
        grn.received_date = payload.received_date
        grn.remarks = payload.remarks
        _build_grn_draft(
            db,
            grn=grn,
            po=po,
            purchase_bill=purchase_bill,
            payload_lines=payload.lines,
        )
        _add_audit_log(
            db,
            entity_type="GRN",
            entity_id=grn.id,
            action="UPDATE",
            performed_by=user_id,
            metadata={
                "grn_number": grn.grn_number,
                "purchase_order_id": po.id,
                "purchase_bill_id": payload.purchase_bill_id,
                "batch_row_count": sum(len(line.batch_lines) for line in grn.lines),
            },
            before_snapshot=before_snapshot,
            after_snapshot=snapshot_model(grn),
        )
        _commit_with_tenant_context(db)
    except Exception:
        db.rollback()
        raise

    return _get_grn_with_lines(db, grn_id)  # type: ignore[return-value]


def attach_bill_to_grn(db: Session, grn_id: int, purchase_bill_id: int, user_id: int) -> GRN:
    grn = _get_grn_with_lines(db, grn_id, lock=True)
    if grn is None:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="GRN not found",
            status_code=404,
        )
    purchase_bill = _get_purchase_bill_with_lines(db, purchase_bill_id, lock=True)
    if purchase_bill is None:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Purchase bill not found",
            status_code=404,
        )
    po = _get_po_with_lines(db, grn.purchase_order_id, lock=True)
    if po is None:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="Purchase order not found",
            status_code=404,
        )
    _validate_bill_matches_po(purchase_bill=purchase_bill, purchase_order=po)

    before_snapshot = snapshot_model(grn)
    grn.purchase_bill_id = purchase_bill.id
    _refresh_grn_purchase_bill_provenance(db, grn=grn, user_id=user_id)
    _add_audit_log(
        db,
        entity_type="GRN",
        entity_id=grn.id,
        action="ATTACH_BILL",
        performed_by=user_id,
        metadata={
            "grn_number": grn.grn_number,
            "purchase_order_id": po.id,
            "purchase_bill_id": purchase_bill.id,
        },
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(grn),
    )
    try:
        _commit_with_tenant_context(db)
    except Exception:
        db.rollback()
        raise
    return _get_grn_with_lines(db, grn_id)  # type: ignore[return-value]


def cancel_grn(db: Session, grn_id: int, user_id: int) -> GRN:
    grn = _get_grn_with_lines(db, grn_id, lock=True)
    if grn is None:
        _raise_purchase_error(
            error_code="NOT_FOUND",
            message="GRN not found",
            status_code=404,
        )
    if grn.status != GrnStatus.DRAFT:
        _raise_purchase_error(
            error_code="INVALID_STATE",
            message="Only draft GRNs can be cancelled",
            status_code=409,
        )
    before_snapshot = snapshot_model(grn)
    grn.status = GrnStatus.CANCELLED
    _add_audit_log(
        db,
        entity_type="GRN",
        entity_id=grn.id,
        action="CANCEL",
        performed_by=user_id,
        metadata={"grn_number": grn.grn_number, "purchase_order_id": grn.purchase_order_id},
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(grn),
    )
    try:
        _commit_with_tenant_context(db)
    except Exception:
        db.rollback()
        raise
    return _get_grn_with_lines(db, grn_id)  # type: ignore[return-value]


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

        if grn.purchase_bill_id is not None:
            purchase_bill = _get_purchase_bill_with_lines(db, grn.purchase_bill_id, lock=True)
            if purchase_bill is None:
                _raise_purchase_error(
                    error_code="NOT_FOUND",
                    message="Linked purchase bill not found",
                    status_code=404,
                )
            _validate_bill_matches_po(purchase_bill=purchase_bill, purchase_order=po)

        po_lines_by_id = {line.id: line for line in po.lines}

        for line in grn.lines:
            if not line.batch_lines:
                _raise_purchase_error(
                    error_code="BATCH_REQUIRED",
                    message="Each GRN line must include at least one batch row",
                    status_code=400,
                )
            po_line = po_lines_by_id.get(line.po_line_id) if line.po_line_id is not None else None
            if not po_line or po_line.purchase_order_id != po.id:
                _raise_purchase_error(
                    error_code="INVALID_STATE",
                    message="GRN line references a PO line from a different purchase order",
                    status_code=409,
                )

            remaining_qty = _as_decimal(po_line.ordered_qty) - _as_decimal(po_line.received_qty)
            if _as_decimal(line.received_qty_total) > remaining_qty:
                _raise_purchase_error(
                    error_code="OVER_RECEIPT",
                    message="Cannot receive more than remaining quantity",
                    status_code=400,
                )

            batch_received_total = sum(
                (_as_decimal(batch_line.received_qty) for batch_line in line.batch_lines),
                Decimal("0"),
            )
            batch_free_total = sum(
                (_as_decimal(batch_line.free_qty) for batch_line in line.batch_lines),
                Decimal("0"),
            )
            if batch_received_total != _as_decimal(line.received_qty_total):
                _raise_purchase_error(
                    error_code="INVALID_STATE",
                    message="Sum of batch received qty must equal line received qty total",
                    status_code=400,
                )
            if batch_free_total != _as_decimal(line.free_qty_total):
                _raise_purchase_error(
                    error_code="INVALID_STATE",
                    message="Sum of batch free qty must equal line free qty total",
                    status_code=400,
                )

            for index, batch_line in enumerate(line.batch_lines):
                batch = _resolve_batch_for_grn_batch(
                    db,
                    product_id=line.product_id,
                    batch_id=batch_line.batch_id,
                    batch_no=batch_line.batch_no,
                    expiry_date=batch_line.expiry_date,
                    mfg_date=batch_line.mfg_date,
                    mrp=batch_line.mrp,
                    create_if_missing=True,
                )
                if batch is None:
                    _raise_purchase_error(
                        error_code="BATCH_REQUIRED",
                        message="Failed to resolve batch for GRN posting",
                        status_code=400,
                    )
                batch_line.batch_id = batch.id
                if index == 0:
                    line.batch_id = batch.id
                    line.expiry_date = batch.expiry_date

                total_stock_qty = _as_decimal(batch_line.received_qty) + _as_decimal(batch_line.free_qty)
                inward_result = stock_in(
                    # Persist unit cost on immutable inward ledger rows for source traceability.
                    db,
                    warehouse_id=grn.warehouse_id,
                    product_id=line.product_id,
                    batch_id=batch.id,
                    qty=total_stock_qty,
                    reason=InventoryReason.PURCHASE_GRN,
                    created_by=user_id,
                    unit_cost=batch_line.unit_cost or line.unit_cost,
                    ref_type="GRN",
                    ref_id=grn.grn_number,
                    commit=False,
                )
                _upsert_stock_source_provenance(
                    db,
                    ledger_id=inward_result.ledger.id,
                    supplier_id=grn.supplier_id,
                    purchase_order_id=grn.purchase_order_id,
                    purchase_bill_id=grn.purchase_bill_id,
                    grn_id=grn.id,
                    grn_line_id=line.id,
                    grn_batch_line_id=batch_line.id,
                    warehouse_id=grn.warehouse_id,
                    product_id=line.product_id,
                    batch_id=batch.id,
                    batch_no=batch.batch_no,
                    expiry_date=batch.expiry_date,
                    inward_date=grn.received_date,
                    received_qty=_as_decimal(batch_line.received_qty),
                    free_qty=_as_decimal(batch_line.free_qty),
                    unit_cost_snapshot=batch_line.unit_cost or line.unit_cost,
                )

            po_line.received_qty = _as_decimal(po_line.received_qty) + _as_decimal(
                line.received_qty_total
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
            metadata={
                "grn_number": grn.grn_number,
                "purchase_order_id": po.id,
                "purchase_bill_id": grn.purchase_bill_id,
                "batch_row_count": sum(len(line.batch_lines) for line in grn.lines),
            },
            after_snapshot=snapshot_model(grn),
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
