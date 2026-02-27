from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.batch import Batch
from app.models.enums import GrnStatus, InventoryReason, PurchaseOrderStatus
from app.models.party import Party
from app.models.product import Product
from app.models.purchase import GRN, GRNLine, PurchaseOrder, PurchaseOrderLine
from app.models.warehouse import Warehouse
from app.schemas.purchase import GRNCreateFromPO, PurchaseOrderCreate
from app.services.inventory import stock_in


class PurchaseError(Exception):
    pass


def _as_decimal(value: Decimal | float | int) -> Decimal:
    return Decimal(str(value))


def _new_po_number() -> str:
    return f"PO-{uuid4().hex[:10].upper()}"


def _new_grn_number() -> str:
    return f"GRN-{uuid4().hex[:10].upper()}"


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


def _assert_master_refs(db: Session, *, supplier_id: int, warehouse_id: int) -> None:
    if not db.get(Party, supplier_id):
        raise PurchaseError("Supplier not found")
    if not db.get(Warehouse, warehouse_id):
        raise PurchaseError("Warehouse not found")


def _assert_product_exists(db: Session, product_id: int) -> None:
    if not db.get(Product, product_id):
        raise PurchaseError(f"Product not found: {product_id}")


def create_po(db: Session, payload: PurchaseOrderCreate, created_by: int) -> PurchaseOrder:
    if not payload.lines:
        raise PurchaseError("Purchase order must include at least one line")

    _assert_master_refs(db, supplier_id=payload.supplier_id, warehouse_id=payload.warehouse_id)

    try:
        po = PurchaseOrder(
            po_number=_new_po_number(),
            supplier_id=payload.supplier_id,
            warehouse_id=payload.warehouse_id,
            status=PurchaseOrderStatus.DRAFT,
            order_date=payload.order_date,
            expected_date=payload.expected_date,
            notes=payload.notes,
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

        db.commit()
    except Exception:
        db.rollback()
        raise

    return _get_po_with_lines(db, po.id)  # type: ignore[return-value]


def approve_po(db: Session, po_id: int, user_id: int) -> PurchaseOrder:
    _ = user_id
    po = _get_po_with_lines(db, po_id)
    if not po:
        raise PurchaseError("Purchase order not found")

    if po.status != PurchaseOrderStatus.DRAFT:
        raise PurchaseError("Only draft purchase orders can be approved")

    if not po.lines:
        raise PurchaseError("Cannot approve a purchase order without lines")

    po.status = PurchaseOrderStatus.APPROVED

    try:
        db.commit()
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
            raise PurchaseError("Batch not found")
        if batch.product_id != product_id:
            raise PurchaseError("Batch does not belong to the PO line product")
        if expiry_date and expiry_date != batch.expiry_date:
            raise PurchaseError("Provided expiry_date does not match selected batch")
        return batch

    if not batch_no or not expiry_date:
        raise PurchaseError("Either batch_id or batch_no with expiry_date is required")

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
        raise PurchaseError("Purchase order not found")

    if po.status not in (PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIALLY_RECEIVED):
        raise PurchaseError("GRN can be created only for approved or partially received PO")

    if payload.supplier_id is not None and payload.supplier_id != po.supplier_id:
        raise PurchaseError("Supplier does not match purchase order")

    if payload.warehouse_id is not None and payload.warehouse_id != po.warehouse_id:
        raise PurchaseError("Warehouse does not match purchase order")

    if not payload.lines:
        raise PurchaseError("GRN must include at least one line")

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
                raise PurchaseError("Duplicate po_line_id in GRN lines")
            seen_po_lines.add(line_payload.po_line_id)

            po_line = po_lines_by_id.get(line_payload.po_line_id)
            if not po_line:
                raise PurchaseError("GRN line references a PO line from a different purchase order")

            remaining_qty = _as_decimal(po_line.ordered_qty) - _as_decimal(po_line.received_qty)
            received_qty = _as_decimal(line_payload.received_qty)
            if received_qty > remaining_qty:
                raise PurchaseError("Received quantity exceeds remaining quantity on PO line")

            free_qty = _as_decimal(line_payload.free_qty)
            if free_qty < 0:
                raise PurchaseError("Free quantity cannot be negative")

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

        db.commit()
    except Exception:
        db.rollback()
        raise

    return _get_grn_with_lines(db, grn.id)  # type: ignore[return-value]


def post_grn(db: Session, grn_id: int, user_id: int) -> GRN:
    try:
        grn = _get_grn_with_lines(db, grn_id, lock=True)
        if not grn:
            raise PurchaseError("GRN not found")
        if grn.status == GrnStatus.POSTED:
            raise PurchaseError("GRN is already posted")
        if grn.status == GrnStatus.CANCELLED:
            raise PurchaseError("Cancelled GRN cannot be posted")
        if not grn.lines:
            raise PurchaseError("Cannot post an empty GRN")

        po = _get_po_with_lines(db, grn.purchase_order_id, lock=True)
        if not po:
            raise PurchaseError("Purchase order not found")
        if po.status == PurchaseOrderStatus.CANCELLED:
            raise PurchaseError("Cannot post GRN for cancelled purchase order")

        po_lines_by_id = {line.id: line for line in po.lines}

        for line in grn.lines:
            po_line = po_lines_by_id.get(line.po_line_id)
            if not po_line or po_line.purchase_order_id != po.id:
                raise PurchaseError("GRN line references a PO line from a different purchase order")

            remaining_qty = _as_decimal(po_line.ordered_qty) - _as_decimal(po_line.received_qty)
            if _as_decimal(line.received_qty) > remaining_qty:
                raise PurchaseError("Posting would exceed ordered quantity")

            total_stock_qty = _as_decimal(line.received_qty) + _as_decimal(line.free_qty)
            if total_stock_qty <= 0:
                raise PurchaseError("Invalid GRN line quantity")

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

        fully_received = all(
            _as_decimal(po_line.received_qty) >= _as_decimal(po_line.ordered_qty)
            for po_line in po.lines
        )
        po.status = (
            PurchaseOrderStatus.CLOSED if fully_received else PurchaseOrderStatus.PARTIALLY_RECEIVED
        )

        grn.status = GrnStatus.POSTED
        grn.posted_at = datetime.now(timezone.utc)
        grn.posted_by = user_id

        db.commit()
    except Exception:
        db.rollback()
        raise

    return _get_grn_with_lines(db, grn_id)  # type: ignore[return-value]
