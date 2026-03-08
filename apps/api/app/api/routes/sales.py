from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.models.sales import DispatchNote, SalesOrder, StockReservation
from app.models.user import User
from app.schemas.sales import (
    DispatchNoteCreate,
    DispatchNoteListResponse,
    DispatchNoteResponse,
    SalesOrderCreate,
    SalesOrderListResponse,
    SalesOrderResponse,
    SalesOrderUpdate,
    StockAvailabilityResponse,
    StockReservationListResponse,
)
from app.services.sales import (
    cancel_dispatch_note,
    cancel_sales_order,
    confirm_sales_order,
    create_dispatch_note_from_sales_order,
    create_sales_order,
    get_stock_availability,
    post_dispatch_note,
    update_sales_order,
)

router = APIRouter()


@router.post("/sales-orders", response_model=SalesOrderResponse, status_code=status.HTTP_201_CREATED)
def create_sales_order_route(
    payload: SalesOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("sales:create")),
) -> SalesOrderResponse:
    return create_sales_order(db, payload, current_user.id)


@router.get("/sales-orders", response_model=SalesOrderListResponse)
def list_sales_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("sales:view")),
) -> SalesOrderListResponse:
    _ = current_user
    records = (
        db.query(SalesOrder)
        .options(selectinload(SalesOrder.lines))
        .order_by(SalesOrder.created_at.desc())
        .all()
    )
    return SalesOrderListResponse(items=records)


@router.get("/sales-orders/{sales_order_id}", response_model=SalesOrderResponse)
def get_sales_order(
    sales_order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("sales:view")),
) -> SalesOrderResponse:
    _ = current_user
    record = (
        db.query(SalesOrder)
        .options(selectinload(SalesOrder.lines), selectinload(SalesOrder.reservations))
        .filter(SalesOrder.id == sales_order_id)
        .first()
    )
    if record is None:
        raise AppException(error_code="NOT_FOUND", message="Sales order not found", status_code=404)
    return record


@router.patch("/sales-orders/{sales_order_id}", response_model=SalesOrderResponse)
def update_sales_order_route(
    sales_order_id: int,
    payload: SalesOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("sales:create")),
) -> SalesOrderResponse:
    return update_sales_order(db, sales_order_id, payload, current_user.id)


@router.post("/sales-orders/{sales_order_id}/confirm", response_model=SalesOrderResponse)
def confirm_sales_order_route(
    sales_order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("sales:confirm")),
) -> SalesOrderResponse:
    return confirm_sales_order(db, sales_order_id, current_user.id)


@router.post("/sales-orders/{sales_order_id}/cancel", response_model=SalesOrderResponse)
def cancel_sales_order_route(
    sales_order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("sales:cancel")),
) -> SalesOrderResponse:
    return cancel_sales_order(db, sales_order_id, current_user.id)


@router.get("/dispatch-notes", response_model=DispatchNoteListResponse)
def list_dispatch_notes(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dispatch:view")),
) -> DispatchNoteListResponse:
    _ = current_user
    records = (
        db.query(DispatchNote)
        .options(selectinload(DispatchNote.lines))
        .order_by(DispatchNote.created_at.desc())
        .all()
    )
    return DispatchNoteListResponse(items=records)


@router.get("/dispatch-notes/{dispatch_note_id}", response_model=DispatchNoteResponse)
def get_dispatch_note(
    dispatch_note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dispatch:view")),
) -> DispatchNoteResponse:
    _ = current_user
    record = (
        db.query(DispatchNote)
        .options(selectinload(DispatchNote.lines))
        .filter(DispatchNote.id == dispatch_note_id)
        .first()
    )
    if record is None:
        raise AppException(error_code="NOT_FOUND", message="Dispatch note not found", status_code=404)
    return record


@router.post(
    "/dispatch-notes/from-sales-order/{sales_order_id}",
    response_model=DispatchNoteResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_dispatch_note_route(
    sales_order_id: int,
    payload: DispatchNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dispatch:create")),
) -> DispatchNoteResponse:
    return create_dispatch_note_from_sales_order(db, sales_order_id, payload, current_user.id)


@router.post("/dispatch-notes/{dispatch_note_id}/post", response_model=DispatchNoteResponse)
def post_dispatch_note_route(
    dispatch_note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dispatch:post")),
) -> DispatchNoteResponse:
    return post_dispatch_note(db, dispatch_note_id, current_user.id)


@router.post("/dispatch-notes/{dispatch_note_id}/cancel", response_model=DispatchNoteResponse)
def cancel_dispatch_note_route(
    dispatch_note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dispatch:cancel")),
) -> DispatchNoteResponse:
    return cancel_dispatch_note(db, dispatch_note_id, current_user.id)


@router.get("/reservations", response_model=StockReservationListResponse)
def list_reservations(
    sales_order_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reservation:view")),
) -> StockReservationListResponse:
    _ = current_user
    query = db.query(StockReservation).order_by(StockReservation.created_at.desc())
    if sales_order_id is not None:
        query = query.filter(StockReservation.sales_order_id == sales_order_id)
    return StockReservationListResponse(items=query.all())


@router.get("/reservations/availability", response_model=StockAvailabilityResponse)
def get_availability(
    warehouse_id: int,
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reservation:view")),
) -> StockAvailabilityResponse:
    _ = current_user
    return get_stock_availability(db, warehouse_id=warehouse_id, product_id=product_id)
