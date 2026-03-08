from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.database import set_tenant_search_path
from app.core.exceptions import AppException
from app.models.batch import Batch
from app.models.enums import (
    DispatchNoteStatus,
    InventoryReason,
    SalesOrderStatus,
    StockReservationStatus,
)
from app.models.inventory import StockSummary
from app.models.party import Party
from app.models.product import Product
from app.models.sales import (
    DispatchLine,
    DispatchNote,
    SalesOrder,
    SalesOrderLine,
    StockReservation,
)
from app.models.warehouse import Warehouse
from app.schemas.sales import (
    BatchAvailabilityResponse,
    DispatchNoteCreate,
    SalesOrderCreate,
    SalesOrderUpdate,
    StockAvailabilityResponse,
)
from app.services.audit import snapshot_model, write_audit_log
from app.services.inventory import stock_out


def _as_decimal(value: Decimal | float | int | str | None) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def _new_so_number() -> str:
    return f"SO-{uuid4().hex[:10].upper()}"


def _new_dispatch_number() -> str:
    return f"DSP-{uuid4().hex[:10].upper()}"


def _raise_sales_error(
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


def _commit_with_tenant_context(db: Session) -> None:
    db.commit()
    tenant_schema = db.info.get("tenant_schema")
    if isinstance(tenant_schema, str) and tenant_schema:
        set_tenant_search_path(db, tenant_schema)


def _get_sales_order_with_lines(
    db: Session,
    sales_order_id: int,
    *,
    lock: bool = False,
) -> SalesOrder | None:
    stmt = (
        select(SalesOrder)
        .where(SalesOrder.id == sales_order_id)
        .options(
            selectinload(SalesOrder.lines),
            selectinload(SalesOrder.reservations),
            selectinload(SalesOrder.dispatch_notes),
        )
    )
    if lock:
        stmt = stmt.with_for_update()
    return db.execute(stmt).scalar_one_or_none()


def _get_dispatch_note_with_lines(
    db: Session,
    dispatch_note_id: int,
    *,
    lock: bool = False,
) -> DispatchNote | None:
    stmt = (
        select(DispatchNote)
        .where(DispatchNote.id == dispatch_note_id)
        .options(selectinload(DispatchNote.lines), selectinload(DispatchNote.sales_order))
    )
    if lock:
        stmt = stmt.with_for_update()
    return db.execute(stmt).scalar_one_or_none()


def _assert_master_refs(db: Session, *, customer_id: int, warehouse_id: int) -> None:
    if not db.get(Party, customer_id):
        _raise_sales_error(
            error_code="NOT_FOUND",
            message="Customer not found",
            status_code=404,
        )
    if not db.get(Warehouse, warehouse_id):
        _raise_sales_error(
            error_code="NOT_FOUND",
            message="Warehouse not found",
            status_code=404,
        )


def _assert_product_exists(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        _raise_sales_error(
            error_code="NOT_FOUND",
            message=f"Product not found: {product_id}",
            status_code=404,
        )
    return product


def _assert_batch_for_product(db: Session, *, batch_id: int, product_id: int) -> Batch:
    batch = db.get(Batch, batch_id)
    if batch is None:
        _raise_sales_error(
            error_code="NOT_FOUND",
            message="Batch not found",
            status_code=404,
        )
    if batch.product_id != product_id:
        _raise_sales_error(
            error_code="INVALID_STATE",
            message="Batch does not belong to the selected product",
            status_code=400,
        )
    return batch


def _active_reservation_statuses() -> tuple[StockReservationStatus, ...]:
    return (
        StockReservationStatus.ACTIVE,
        StockReservationStatus.PARTIALLY_CONSUMED,
    )


def get_reserved_qty(
    db: Session,
    *,
    warehouse_id: int,
    product_id: int,
    exclude_sales_order_id: int | None = None,
) -> Decimal:
    stmt = (
        select(StockReservation)
        .where(StockReservation.warehouse_id == warehouse_id)
        .where(StockReservation.product_id == product_id)
        .where(StockReservation.status.in_(_active_reservation_statuses()))
    )
    if exclude_sales_order_id is not None:
        stmt = stmt.where(StockReservation.sales_order_id != exclude_sales_order_id)

    reservations = db.execute(stmt).scalars().all()
    reserved_qty = Decimal("0")
    for reservation in reservations:
        remaining = (
            _as_decimal(reservation.reserved_qty)
            - _as_decimal(reservation.consumed_qty)
            - _as_decimal(reservation.released_qty)
        )
        if remaining > 0:
            reserved_qty += remaining
    return reserved_qty


def get_stock_availability(
    db: Session,
    *,
    warehouse_id: int,
    product_id: int,
    exclude_sales_order_id: int | None = None,
) -> StockAvailabilityResponse:
    summary_rows = db.execute(
        select(StockSummary)
        .where(StockSummary.warehouse_id == warehouse_id)
        .where(StockSummary.product_id == product_id)
    ).scalars().all()
    on_hand_qty = sum((_as_decimal(row.qty_on_hand) for row in summary_rows), Decimal("0"))
    reserved_qty = get_reserved_qty(
        db,
        warehouse_id=warehouse_id,
        product_id=product_id,
        exclude_sales_order_id=exclude_sales_order_id,
    )
    candidate_rows = db.execute(
        select(StockSummary, Batch)
        .join(Batch, Batch.id == StockSummary.batch_id)
        .where(StockSummary.warehouse_id == warehouse_id)
        .where(StockSummary.product_id == product_id)
        .where(StockSummary.qty_on_hand > 0)
        .order_by(Batch.expiry_date.asc(), Batch.id.asc())
    ).all()

    candidate_batches = [
        BatchAvailabilityResponse(
            batch_id=batch.id,
            batch_no=batch.batch_no,
            expiry_date=batch.expiry_date,
            qty_on_hand=_as_decimal(summary.qty_on_hand),
        )
        for summary, batch in candidate_rows
    ]
    return StockAvailabilityResponse(
        warehouse_id=warehouse_id,
        product_id=product_id,
        on_hand_qty=on_hand_qty,
        reserved_qty=reserved_qty,
        available_qty=on_hand_qty - reserved_qty,
        candidate_batches=candidate_batches,
    )


def _add_sales_audit(
    db: Session,
    *,
    entity_type: str,
    entity_id: int,
    action: str,
    performed_by: int,
    summary: str | None = None,
    remarks: str | None = None,
    source_reference: str | None = None,
    before_snapshot: dict | None = None,
    after_snapshot: dict | None = None,
    metadata: dict | None = None,
) -> None:
    write_audit_log(
        db,
        module="Sales",
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        performed_by=performed_by,
        summary=summary,
        remarks=remarks,
        source_reference=source_reference,
        before_snapshot=before_snapshot,
        after_snapshot=after_snapshot,
        metadata=metadata,
    )


def _line_total(*, ordered_qty: Decimal, unit_price: Decimal, discount_percent: Decimal) -> Decimal:
    gross = ordered_qty * unit_price
    discount_amount = (gross * discount_percent) / Decimal("100")
    return gross - discount_amount


def _payload_has_field(payload: SalesOrderCreate | SalesOrderUpdate, field_name: str) -> bool:
    return field_name in getattr(payload, "model_fields_set", set())


def _sync_sales_order_lines(
    db: Session,
    sales_order: SalesOrder,
    lines_payload,
) -> None:
    sales_order.lines.clear()
    db.flush()
    subtotal = Decimal("0")
    for line in lines_payload:
        product = _assert_product_exists(db, line.product_id)
        line_total = _line_total(
            ordered_qty=_as_decimal(line.ordered_qty),
            unit_price=_as_decimal(line.unit_price),
            discount_percent=_as_decimal(line.discount_percent),
        )
        subtotal += line_total
        sales_order.lines.append(
            SalesOrderLine(
                product_id=line.product_id,
                ordered_qty=_as_decimal(line.ordered_qty),
                reserved_qty=Decimal("0"),
                dispatched_qty=Decimal("0"),
                unit_price=_as_decimal(line.unit_price),
                discount_percent=_as_decimal(line.discount_percent),
                line_total=line_total,
                gst_rate=_as_decimal(line.gst_rate),
                hsn_code=line.hsn_code or product.hsn,
                remarks=line.remarks,
            )
        )
    sales_order.subtotal = subtotal


def _apply_financials(sales_order: SalesOrder, payload: SalesOrderCreate | SalesOrderUpdate) -> None:
    explicit_subtotal = payload.subtotal if _payload_has_field(payload, "subtotal") else None
    if explicit_subtotal is not None:
        sales_order.subtotal = _as_decimal(explicit_subtotal)
    if _payload_has_field(payload, "discount_percent") and getattr(payload, "discount_percent", None) is not None:
        sales_order.discount_percent = _as_decimal(payload.discount_percent)
    if _payload_has_field(payload, "discount_amount") and getattr(payload, "discount_amount", None) is not None:
        sales_order.discount_amount = _as_decimal(payload.discount_amount)
    if _payload_has_field(payload, "tax_type"):
        sales_order.tax_type = payload.tax_type
    if _payload_has_field(payload, "tax_percent") and getattr(payload, "tax_percent", None) is not None:
        sales_order.tax_percent = _as_decimal(payload.tax_percent)
    if _payload_has_field(payload, "tax_amount") and getattr(payload, "tax_amount", None) is not None:
        sales_order.tax_amount = _as_decimal(payload.tax_amount)
    if _payload_has_field(payload, "adjustment") and getattr(payload, "adjustment", None) is not None:
        sales_order.adjustment = _as_decimal(payload.adjustment)
    explicit_total = payload.total if _payload_has_field(payload, "total") else None
    computed_total = (
        _as_decimal(sales_order.subtotal)
        - _as_decimal(sales_order.discount_amount)
        + _as_decimal(sales_order.tax_amount)
        + _as_decimal(sales_order.adjustment)
    )
    sales_order.total = _as_decimal(explicit_total) if explicit_total is not None else computed_total


def create_sales_order(db: Session, payload: SalesOrderCreate, created_by: int) -> SalesOrder:
    if not payload.lines:
        _raise_sales_error(
            error_code="INVALID_STATE",
            message="Sales order must include at least one line",
            status_code=400,
        )
    _assert_master_refs(db, customer_id=payload.customer_id, warehouse_id=payload.warehouse_id)

    try:
        sales_order = SalesOrder(
            so_number=_new_so_number(),
            customer_id=payload.customer_id,
            warehouse_id=payload.warehouse_id,
            status=SalesOrderStatus.DRAFT,
            order_date=payload.order_date,
            expected_dispatch_date=payload.expected_dispatch_date,
            remarks=payload.remarks,
            created_by=created_by,
        )
        db.add(sales_order)
        db.flush()
        _sync_sales_order_lines(db, sales_order, payload.lines)
        _apply_financials(sales_order, payload)
        _add_sales_audit(
            db,
            entity_type="SALES_ORDER",
            entity_id=sales_order.id,
            action="CREATE",
            performed_by=created_by,
            summary=f"Created sales order {sales_order.so_number}",
            source_reference=sales_order.so_number,
            after_snapshot=snapshot_model(sales_order),
        )
        _commit_with_tenant_context(db)
    except Exception:
        db.rollback()
        raise
    return _get_sales_order_with_lines(db, sales_order.id)  # type: ignore[return-value]


def update_sales_order(db: Session, sales_order_id: int, payload: SalesOrderUpdate, updated_by: int) -> SalesOrder:
    sales_order = _get_sales_order_with_lines(db, sales_order_id, lock=True)
    if sales_order is None:
        _raise_sales_error(
            error_code="NOT_FOUND",
            message="Sales order not found",
            status_code=404,
        )
    if sales_order.status != SalesOrderStatus.DRAFT:
        _raise_sales_error(
            error_code="INVALID_STATE",
            message="Only draft sales orders can be updated",
            status_code=409,
        )

    before_snapshot = snapshot_model(sales_order)
    if payload.customer_id is not None or payload.warehouse_id is not None:
        _assert_master_refs(
            db,
            customer_id=payload.customer_id or sales_order.customer_id,
            warehouse_id=payload.warehouse_id or sales_order.warehouse_id,
        )
    if payload.customer_id is not None:
        sales_order.customer_id = payload.customer_id
    if payload.warehouse_id is not None:
        sales_order.warehouse_id = payload.warehouse_id
    if payload.order_date is not None:
        sales_order.order_date = payload.order_date
    if payload.expected_dispatch_date is not None:
        sales_order.expected_dispatch_date = payload.expected_dispatch_date
    if payload.remarks is not None:
        sales_order.remarks = payload.remarks
    if payload.lines is not None:
        _sync_sales_order_lines(db, sales_order, payload.lines)
    _apply_financials(sales_order, payload)

    _add_sales_audit(
        db,
        entity_type="SALES_ORDER",
        entity_id=sales_order.id,
        action="UPDATE",
        performed_by=updated_by,
        summary=f"Updated sales order {sales_order.so_number}",
        source_reference=sales_order.so_number,
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(sales_order),
    )
    _commit_with_tenant_context(db)
    return _get_sales_order_with_lines(db, sales_order.id)  # type: ignore[return-value]


def confirm_sales_order(db: Session, sales_order_id: int, confirmed_by: int) -> SalesOrder:
    sales_order = _get_sales_order_with_lines(db, sales_order_id, lock=True)
    if sales_order is None:
        _raise_sales_error(
            error_code="NOT_FOUND",
            message="Sales order not found",
            status_code=404,
        )
    if sales_order.status != SalesOrderStatus.DRAFT:
        _raise_sales_error(
            error_code="INVALID_STATE",
            message="Only draft sales orders can be confirmed",
            status_code=409,
        )

    shortages: list[dict[str, str]] = []
    for line in sales_order.lines:
        availability = get_stock_availability(
            db,
            warehouse_id=sales_order.warehouse_id,
            product_id=line.product_id,
            exclude_sales_order_id=sales_order.id,
        )
        if availability.available_qty < _as_decimal(line.ordered_qty):
            shortages.append(
                {
                    "product_id": str(line.product_id),
                    "required_qty": str(line.ordered_qty),
                    "available_qty": str(availability.available_qty),
                }
            )

    if shortages:
        _raise_sales_error(
            error_code="INSUFFICIENT_AVAILABLE_STOCK",
            message="Cannot confirm sales order because available stock is insufficient",
            status_code=409,
            details=shortages,
        )

    for line in sales_order.lines:
        line.reserved_qty = _as_decimal(line.ordered_qty)
        reservation = StockReservation(
            sales_order_id=sales_order.id,
            sales_order_line_id=line.id,
            warehouse_id=sales_order.warehouse_id,
            product_id=line.product_id,
            batch_id=None,
            reserved_qty=_as_decimal(line.ordered_qty),
            consumed_qty=Decimal("0"),
            released_qty=Decimal("0"),
            status=StockReservationStatus.ACTIVE,
        )
        db.add(reservation)
        db.flush()
        _add_sales_audit(
            db,
            entity_type="STOCK_RESERVATION",
            entity_id=reservation.id,
            action="CREATE",
            performed_by=confirmed_by,
            summary=f"Reserved stock for {sales_order.so_number}",
            source_reference=sales_order.so_number,
            after_snapshot=snapshot_model(reservation),
        )

    sales_order.status = SalesOrderStatus.CONFIRMED
    _add_sales_audit(
        db,
        entity_type="SALES_ORDER",
        entity_id=sales_order.id,
        action="CONFIRM",
        performed_by=confirmed_by,
        summary=f"Confirmed sales order {sales_order.so_number}",
        source_reference=sales_order.so_number,
        before_snapshot={"status": SalesOrderStatus.DRAFT.value},
        after_snapshot={"status": sales_order.status.value},
    )
    _commit_with_tenant_context(db)
    return _get_sales_order_with_lines(db, sales_order.id)  # type: ignore[return-value]


def cancel_sales_order(db: Session, sales_order_id: int, cancelled_by: int) -> SalesOrder:
    sales_order = _get_sales_order_with_lines(db, sales_order_id, lock=True)
    if sales_order is None:
        _raise_sales_error(
            error_code="NOT_FOUND",
            message="Sales order not found",
            status_code=404,
        )
    if sales_order.status == SalesOrderStatus.CANCELLED:
        return sales_order
    if sales_order.status == SalesOrderStatus.DISPATCHED:
        _raise_sales_error(
            error_code="INVALID_STATE",
            message="Dispatched sales orders cannot be cancelled",
            status_code=409,
        )
    if any(dispatch.status == DispatchNoteStatus.POSTED for dispatch in sales_order.dispatch_notes):
        _raise_sales_error(
            error_code="INVALID_STATE",
            message="Cannot cancel a sales order with posted dispatches",
            status_code=409,
        )

    for reservation in sales_order.reservations:
        remaining = (
            _as_decimal(reservation.reserved_qty)
            - _as_decimal(reservation.consumed_qty)
            - _as_decimal(reservation.released_qty)
        )
        if remaining <= 0:
            continue
        reservation.released_qty = _as_decimal(reservation.released_qty) + remaining
        reservation.status = StockReservationStatus.RELEASED
        line = next((candidate for candidate in sales_order.lines if candidate.id == reservation.sales_order_line_id), None)
        if line is not None:
            line.reserved_qty = max(Decimal("0"), _as_decimal(line.reserved_qty) - remaining)
        _add_sales_audit(
            db,
            entity_type="STOCK_RESERVATION",
            entity_id=reservation.id,
            action="RELEASE",
            performed_by=cancelled_by,
            summary=f"Released reservation for {sales_order.so_number}",
            source_reference=sales_order.so_number,
            before_snapshot={"status": StockReservationStatus.ACTIVE.value},
            after_snapshot={
                "status": reservation.status.value,
                "released_qty": str(reservation.released_qty),
            },
        )

    previous_status = sales_order.status
    sales_order.status = SalesOrderStatus.CANCELLED
    _add_sales_audit(
        db,
        entity_type="SALES_ORDER",
        entity_id=sales_order.id,
        action="CANCEL",
        performed_by=cancelled_by,
        summary=f"Cancelled sales order {sales_order.so_number}",
        source_reference=sales_order.so_number,
        before_snapshot={"status": previous_status.value},
        after_snapshot={"status": sales_order.status.value},
    )
    _commit_with_tenant_context(db)
    return _get_sales_order_with_lines(db, sales_order.id)  # type: ignore[return-value]


def create_dispatch_note_from_sales_order(
    db: Session,
    sales_order_id: int,
    payload: DispatchNoteCreate,
    created_by: int,
) -> DispatchNote:
    sales_order = _get_sales_order_with_lines(db, sales_order_id, lock=True)
    if sales_order is None:
        _raise_sales_error(
            error_code="NOT_FOUND",
            message="Sales order not found",
            status_code=404,
        )
    if sales_order.status not in (SalesOrderStatus.CONFIRMED, SalesOrderStatus.PARTIALLY_DISPATCHED):
        _raise_sales_error(
            error_code="INVALID_STATE",
            message="Dispatch can only be created for confirmed sales orders",
            status_code=409,
        )
    if not payload.lines:
        _raise_sales_error(
            error_code="INVALID_STATE",
            message="Dispatch note must include at least one line",
            status_code=400,
        )

    lines_by_id = {line.id: line for line in sales_order.lines}
    reservations_by_line = {
        reservation.sales_order_line_id: reservation
        for reservation in sales_order.reservations
        if reservation.status in _active_reservation_statuses()
    }
    requested_qty_by_line: dict[int, Decimal] = defaultdict(lambda: Decimal("0"))
    requested_qty_by_batch: dict[tuple[int, int], Decimal] = defaultdict(lambda: Decimal("0"))

    dispatch_note = DispatchNote(
        dispatch_number=_new_dispatch_number(),
        sales_order_id=sales_order.id,
        customer_id=sales_order.customer_id,
        warehouse_id=sales_order.warehouse_id,
        status=DispatchNoteStatus.DRAFT,
        dispatch_date=payload.dispatch_date,
        remarks=payload.remarks,
        created_by=created_by,
    )
    db.add(dispatch_note)
    db.flush()

    for line_payload in payload.lines:
        sales_line = lines_by_id.get(line_payload.sales_order_line_id)
        if sales_line is None:
            _raise_sales_error(
                error_code="NOT_FOUND",
                message="Sales order line not found for dispatch",
                status_code=404,
            )
        reservation = reservations_by_line.get(sales_line.id)
        reservation_remaining = (
            _as_decimal(reservation.reserved_qty)
            - _as_decimal(reservation.consumed_qty)
            - _as_decimal(reservation.released_qty)
            if reservation is not None
            else Decimal("0")
        )
        remaining_qty = _as_decimal(sales_line.ordered_qty) - _as_decimal(sales_line.dispatched_qty)
        dispatch_qty = _as_decimal(line_payload.dispatched_qty)
        if dispatch_qty > remaining_qty:
            _raise_sales_error(
                error_code="INVALID_STATE",
                message="Cannot dispatch more than remaining ordered quantity",
                status_code=409,
            )
        if dispatch_qty > reservation_remaining:
            _raise_sales_error(
                error_code="INVALID_STATE",
                message="Cannot dispatch more than remaining reserved quantity",
                status_code=409,
            )
        cumulative_requested_for_line = requested_qty_by_line[sales_line.id] + dispatch_qty
        if cumulative_requested_for_line > remaining_qty:
            _raise_sales_error(
                error_code="INVALID_STATE",
                message="Cannot dispatch more than remaining ordered quantity",
                status_code=409,
            )
        if cumulative_requested_for_line > reservation_remaining:
            _raise_sales_error(
                error_code="INVALID_STATE",
                message="Cannot dispatch more than remaining reserved quantity",
                status_code=409,
            )

        batch = _assert_batch_for_product(db, batch_id=line_payload.batch_id, product_id=sales_line.product_id)
        batch_summary = db.execute(
            select(StockSummary)
            .where(StockSummary.warehouse_id == sales_order.warehouse_id)
            .where(StockSummary.product_id == sales_line.product_id)
            .where(StockSummary.batch_id == batch.id)
            .with_for_update()
        ).scalar_one_or_none()
        batch_on_hand = _as_decimal(batch_summary.qty_on_hand) if batch_summary is not None else Decimal("0")
        batch_key = (sales_line.product_id, batch.id)
        cumulative_requested_for_batch = requested_qty_by_batch[batch_key] + dispatch_qty
        if batch_on_hand < cumulative_requested_for_batch:
            _raise_sales_error(
                error_code="INSUFFICIENT_STOCK",
                message="Selected batch does not have enough on-hand quantity",
                status_code=409,
            )
        requested_qty_by_line[sales_line.id] = cumulative_requested_for_line
        requested_qty_by_batch[batch_key] = cumulative_requested_for_batch

        dispatch_note.lines.append(
            DispatchLine(
                sales_order_line_id=sales_line.id,
                product_id=sales_line.product_id,
                batch_id=batch.id,
                expiry_date_snapshot=batch.expiry_date,
                dispatched_qty=dispatch_qty,
                unit_price_snapshot=_as_decimal(sales_line.unit_price),
                line_total=dispatch_qty * _as_decimal(sales_line.unit_price),
            )
        )

    _add_sales_audit(
        db,
        entity_type="DISPATCH_NOTE",
        entity_id=dispatch_note.id,
        action="CREATE",
        performed_by=created_by,
        summary=f"Created dispatch note {dispatch_note.dispatch_number}",
        source_reference=dispatch_note.dispatch_number,
        after_snapshot=snapshot_model(dispatch_note),
    )
    _commit_with_tenant_context(db)
    return _get_dispatch_note_with_lines(db, dispatch_note.id)  # type: ignore[return-value]


def post_dispatch_note(db: Session, dispatch_note_id: int, posted_by: int) -> DispatchNote:
    dispatch_note = _get_dispatch_note_with_lines(db, dispatch_note_id, lock=True)
    if dispatch_note is None:
        _raise_sales_error(
            error_code="NOT_FOUND",
            message="Dispatch note not found",
            status_code=404,
        )
    if dispatch_note.status == DispatchNoteStatus.POSTED:
        _raise_sales_error(
            error_code="INVALID_STATE",
            message="Dispatch note has already been posted",
            status_code=409,
        )
    if dispatch_note.status == DispatchNoteStatus.CANCELLED:
        _raise_sales_error(
            error_code="INVALID_STATE",
            message="Cancelled dispatch notes cannot be posted",
            status_code=409,
        )

    sales_order = _get_sales_order_with_lines(db, dispatch_note.sales_order_id, lock=True)
    if sales_order is None:
        _raise_sales_error(
            error_code="NOT_FOUND",
            message="Linked sales order not found",
            status_code=404,
        )

    lines_by_id = {line.id: line for line in sales_order.lines}
    reservations_by_line = {
        reservation.sales_order_line_id: reservation
        for reservation in sales_order.reservations
        if reservation.status in _active_reservation_statuses()
    }

    for dispatch_line in dispatch_note.lines:
        sales_line = lines_by_id.get(dispatch_line.sales_order_line_id)
        if sales_line is None:
            _raise_sales_error(
                error_code="NOT_FOUND",
                message="Sales order line for dispatch not found",
                status_code=404,
            )
        reservation = reservations_by_line.get(sales_line.id)
        if reservation is None:
            _raise_sales_error(
                error_code="INVALID_STATE",
                message="No active reservation found for dispatch line",
                status_code=409,
            )

        dispatch_qty = _as_decimal(dispatch_line.dispatched_qty)
        remaining_qty = _as_decimal(sales_line.ordered_qty) - _as_decimal(sales_line.dispatched_qty)
        reservation_remaining = (
            _as_decimal(reservation.reserved_qty)
            - _as_decimal(reservation.consumed_qty)
            - _as_decimal(reservation.released_qty)
        )
        if dispatch_qty > remaining_qty:
            _raise_sales_error(
                error_code="INVALID_STATE",
                message="Dispatch quantity exceeds remaining sales order quantity",
                status_code=409,
            )
        if dispatch_qty > reservation_remaining:
            _raise_sales_error(
                error_code="INVALID_STATE",
                message="Dispatch quantity exceeds reserved quantity",
                status_code=409,
            )

        _assert_batch_for_product(db, batch_id=dispatch_line.batch_id, product_id=dispatch_line.product_id)
        stock_out(
            db,
            warehouse_id=dispatch_note.warehouse_id,
            product_id=dispatch_line.product_id,
            batch_id=dispatch_line.batch_id,
            qty=dispatch_qty,
            reason=InventoryReason.SALES_DISPATCH,
            created_by=posted_by,
            ref_type="DISPATCH",
            ref_id=dispatch_note.dispatch_number,
            commit=False,
        )

        sales_line.dispatched_qty = _as_decimal(sales_line.dispatched_qty) + dispatch_qty
        sales_line.reserved_qty = max(Decimal("0"), _as_decimal(sales_line.reserved_qty) - dispatch_qty)
        reservation.consumed_qty = _as_decimal(reservation.consumed_qty) + dispatch_qty
        remaining_reservation = (
            _as_decimal(reservation.reserved_qty)
            - _as_decimal(reservation.consumed_qty)
            - _as_decimal(reservation.released_qty)
        )
        reservation.status = (
            StockReservationStatus.CONSUMED
            if remaining_reservation <= 0
            else StockReservationStatus.PARTIALLY_CONSUMED
        )

    sales_order.status = (
        SalesOrderStatus.DISPATCHED
        if all(_as_decimal(line.dispatched_qty) >= _as_decimal(line.ordered_qty) for line in sales_order.lines)
        else SalesOrderStatus.PARTIALLY_DISPATCHED
    )
    dispatch_note.status = DispatchNoteStatus.POSTED
    dispatch_note.posted_by = posted_by
    dispatch_note.posted_at = datetime.now(timezone.utc)

    _add_sales_audit(
        db,
        entity_type="DISPATCH_NOTE",
        entity_id=dispatch_note.id,
        action="POST",
        performed_by=posted_by,
        summary=f"Posted dispatch note {dispatch_note.dispatch_number}",
        source_reference=dispatch_note.dispatch_number,
        before_snapshot={"status": DispatchNoteStatus.DRAFT.value},
        after_snapshot={"status": dispatch_note.status.value},
    )
    _add_sales_audit(
        db,
        entity_type="SALES_ORDER",
        entity_id=sales_order.id,
        action="DISPATCH",
        performed_by=posted_by,
        summary=f"Updated dispatch status for {sales_order.so_number}",
        source_reference=dispatch_note.dispatch_number,
        after_snapshot={"status": sales_order.status.value},
    )
    _commit_with_tenant_context(db)
    return _get_dispatch_note_with_lines(db, dispatch_note.id)  # type: ignore[return-value]


def cancel_dispatch_note(db: Session, dispatch_note_id: int, cancelled_by: int) -> DispatchNote:
    dispatch_note = _get_dispatch_note_with_lines(db, dispatch_note_id, lock=True)
    if dispatch_note is None:
        _raise_sales_error(
            error_code="NOT_FOUND",
            message="Dispatch note not found",
            status_code=404,
        )
    if dispatch_note.status == DispatchNoteStatus.POSTED:
        _raise_sales_error(
            error_code="INVALID_STATE",
            message="Posted dispatch notes cannot be cancelled",
            status_code=409,
        )
    if dispatch_note.status == DispatchNoteStatus.CANCELLED:
        return dispatch_note

    dispatch_note.status = DispatchNoteStatus.CANCELLED
    _add_sales_audit(
        db,
        entity_type="DISPATCH_NOTE",
        entity_id=dispatch_note.id,
        action="CANCEL",
        performed_by=cancelled_by,
        summary=f"Cancelled dispatch note {dispatch_note.dispatch_number}",
        source_reference=dispatch_note.dispatch_number,
        before_snapshot={"status": DispatchNoteStatus.DRAFT.value},
        after_snapshot={"status": dispatch_note.status.value},
    )
    _commit_with_tenant_context(db)
    return _get_dispatch_note_with_lines(db, dispatch_note.id)  # type: ignore[return-value]


def list_fefo_suggestions(
    db: Session,
    *,
    warehouse_id: int,
    product_ids: list[int],
) -> dict[int, list[BatchAvailabilityResponse]]:
    suggestions: dict[int, list[BatchAvailabilityResponse]] = defaultdict(list)
    for product_id in product_ids:
        availability = get_stock_availability(
            db,
            warehouse_id=warehouse_id,
            product_id=product_id,
        )
        suggestions[product_id] = availability.candidate_batches
    return suggestions
