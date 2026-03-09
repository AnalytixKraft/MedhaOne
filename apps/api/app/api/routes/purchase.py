from datetime import date

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.database import get_db
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.models.party import Party
from app.models.purchase import GRN, GRNLine, PurchaseOrder, PurchaseOrderLine
from app.models.purchase_bill import PurchaseBill
from app.models.user import User
from app.schemas.purchase import (
    GRNCreateFromBill,
    GRNCreateFromPO,
    GRNResponse,
    GRNUpdate,
    GrnAttachBillPayload,
    PurchaseOrderCreate,
    PurchaseOrderList,
    PurchaseOrderResponse,
    PurchaseOrderUpdate,
)
from app.services.purchase import (
    approve_po,
    attach_bill_to_grn,
    cancel_grn,
    cancel_po,
    create_grn_from_bill,
    create_grn_from_po,
    create_po,
    post_grn,
    update_grn,
    update_po,
)

router = APIRouter()


@router.post("/po", response_model=PurchaseOrderResponse, status_code=status.HTTP_201_CREATED)
def create_purchase_order(
    payload: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase:create")),
) -> PurchaseOrderResponse:
    return create_po(db, payload, current_user.id)


@router.get("/po", response_model=PurchaseOrderList)
def list_purchase_orders(
    search: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    supplier_id: int | None = Query(default=None),
    warehouse_id: int | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase:view")),
) -> PurchaseOrderList:
    _ = current_user
    query = (
        db.query(PurchaseOrder)
        .options(
            selectinload(PurchaseOrder.lines).joinedload(PurchaseOrderLine.product),
            joinedload(PurchaseOrder.supplier),
            joinedload(PurchaseOrder.warehouse),
        )
        .order_by(PurchaseOrder.created_at.desc())
    )
    if status_filter:
        query = query.filter(PurchaseOrder.status == status_filter)
    if supplier_id is not None:
        query = query.filter(PurchaseOrder.supplier_id == supplier_id)
    if warehouse_id is not None:
        query = query.filter(PurchaseOrder.warehouse_id == warehouse_id)
    if date_from is not None:
        query = query.filter(PurchaseOrder.order_date >= date_from)
    if date_to is not None:
        query = query.filter(PurchaseOrder.order_date <= date_to)
    if search:
        like_search = f"%{search.strip()}%"
        query = query.join(PurchaseOrder.supplier).filter(
            (PurchaseOrder.po_number.ilike(like_search)) | (Party.name.ilike(like_search))
        )
    records = query.all()
    return PurchaseOrderList(items=records)


@router.get("/po/{po_id}", response_model=PurchaseOrderResponse)
def get_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase:view")),
) -> PurchaseOrderResponse:
    _ = current_user
    record = (
        db.query(PurchaseOrder)
        .options(
            selectinload(PurchaseOrder.lines).joinedload(PurchaseOrderLine.product),
            joinedload(PurchaseOrder.supplier),
            joinedload(PurchaseOrder.warehouse),
        )
        .filter(PurchaseOrder.id == po_id)
        .first()
    )
    if not record:
        raise AppException(
            error_code="NOT_FOUND",
            message="Purchase order not found",
            status_code=404,
        )
    return record


@router.patch("/po/{po_id}", response_model=PurchaseOrderResponse)
def update_purchase_order(
    po_id: int,
    payload: PurchaseOrderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase:update")),
) -> PurchaseOrderResponse:
    return update_po(db, po_id, payload, current_user.id)


@router.post("/po/{po_id}/approve", response_model=PurchaseOrderResponse)
def approve_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase:approve")),
) -> PurchaseOrderResponse:
    return approve_po(db, po_id, current_user.id)


@router.post("/po/{po_id}/cancel", response_model=PurchaseOrderResponse)
def cancel_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase:cancel")),
) -> PurchaseOrderResponse:
    return cancel_po(db, po_id, current_user.id)


@router.post(
    "/grn/from-po/{po_id}", response_model=GRNResponse, status_code=status.HTTP_201_CREATED
)
def create_grn_from_purchase_order(
    po_id: int,
    payload: GRNCreateFromPO,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("grn:create")),
) -> GRNResponse:
    return create_grn_from_po(db, po_id, payload, current_user.id)


@router.post(
    "/grn/from-bill/{purchase_bill_id}",
    response_model=GRNResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_grn_from_purchase_bill(
    purchase_bill_id: int,
    payload: GRNCreateFromBill,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("grn:create")),
) -> GRNResponse:
    return create_grn_from_bill(db, purchase_bill_id, payload, current_user.id)


@router.get("/grn", response_model=list[GRNResponse])
def list_grns(
    search: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    supplier_id: int | None = Query(default=None),
    warehouse_id: int | None = Query(default=None),
    po_number: str | None = Query(default=None),
    bill_number: str | None = Query(default=None),
    grn_number: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("grn:view")),
) -> list[GRNResponse]:
    _ = current_user
    query = (
        db.query(GRN)
        .options(
            selectinload(GRN.purchase_order),
            selectinload(GRN.purchase_bill),
            selectinload(GRN.supplier),
            selectinload(GRN.warehouse),
            selectinload(GRN.creator),
            selectinload(GRN.poster),
            selectinload(GRN.lines).selectinload(GRNLine.product),
            selectinload(GRN.lines).selectinload(GRNLine.batch_lines),
        )
        .order_by(GRN.created_at.desc())
    )
    if status_filter:
        query = query.filter(GRN.status == status_filter)
    if supplier_id is not None:
        query = query.filter(GRN.supplier_id == supplier_id)
    if warehouse_id is not None:
        query = query.filter(GRN.warehouse_id == warehouse_id)
    if date_from is not None:
        query = query.filter(GRN.received_date >= date_from)
    if date_to is not None:
        query = query.filter(GRN.received_date <= date_to)
    if grn_number:
        query = query.filter(GRN.grn_number.ilike(f"%{grn_number.strip()}%"))
    if po_number:
        query = query.join(GRN.purchase_order).filter(PurchaseOrder.po_number.ilike(f"%{po_number.strip()}%"))
    if bill_number:
        query = query.join(GRN.purchase_bill).filter(PurchaseBill.bill_number.ilike(f"%{bill_number.strip()}%"))
    if search:
        like_search = f"%{search.strip()}%"
        query = query.join(GRN.supplier).filter(
            (GRN.grn_number.ilike(like_search))
            | (Party.name.ilike(like_search))
        )
    return query.all()


@router.get("/grn/{grn_id}", response_model=GRNResponse)
def get_grn(
    grn_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("grn:view")),
) -> GRNResponse:
    _ = current_user
    record = (
        db.query(GRN)
        .options(
            selectinload(GRN.purchase_order),
            selectinload(GRN.purchase_bill),
            selectinload(GRN.supplier),
            selectinload(GRN.warehouse),
            selectinload(GRN.creator),
            selectinload(GRN.poster),
            selectinload(GRN.lines).selectinload(GRNLine.product),
            selectinload(GRN.lines).selectinload(GRNLine.batch_lines),
        )
        .filter(GRN.id == grn_id)
        .first()
    )
    if not record:
        raise AppException(error_code="NOT_FOUND", message="GRN not found", status_code=404)
    return record


@router.patch("/grn/{grn_id}", response_model=GRNResponse)
def update_grn_route(
    grn_id: int,
    payload: GRNUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("grn:edit")),
) -> GRNResponse:
    return update_grn(db, grn_id, payload, current_user.id)


@router.post("/grn/{grn_id}/post", response_model=GRNResponse)
def post_grn_route(
    grn_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("grn:post")),
) -> GRNResponse:
    return post_grn(db, grn_id, current_user.id)


@router.post("/grn/{grn_id}/cancel", response_model=GRNResponse)
def cancel_grn_route(
    grn_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("grn:cancel")),
) -> GRNResponse:
    return cancel_grn(db, grn_id, current_user.id)


@router.post("/grn/{grn_id}/attach-bill", response_model=GRNResponse)
def attach_bill_to_grn_route(
    grn_id: int,
    payload: GrnAttachBillPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("grn:attach_bill")),
) -> GRNResponse:
    return attach_bill_to_grn(db, grn_id, payload.purchase_bill_id, current_user.id)
