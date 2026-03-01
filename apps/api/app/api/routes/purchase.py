from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.models.purchase import GRN, PurchaseOrder
from app.models.user import User
from app.schemas.purchase import (
    GRNCreateFromPO,
    GRNResponse,
    PurchaseOrderCreate,
    PurchaseOrderList,
    PurchaseOrderResponse,
)
from app.services.purchase import approve_po, create_grn_from_po, create_po, post_grn

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
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> PurchaseOrderList:
    _ = current_user
    records = (
        db.query(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines))
        .order_by(PurchaseOrder.created_at.desc())
        .all()
    )
    return PurchaseOrderList(items=records)


@router.get("/po/{po_id}", response_model=PurchaseOrderResponse)
def get_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> PurchaseOrderResponse:
    _ = current_user
    record = (
        db.query(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines))
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


@router.post("/po/{po_id}/approve", response_model=PurchaseOrderResponse)
def approve_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase:approve")),
) -> PurchaseOrderResponse:
    return approve_po(db, po_id, current_user.id)


@router.post(
    "/grn/from-po/{po_id}", response_model=GRNResponse, status_code=status.HTTP_201_CREATED
)
def create_grn(
    po_id: int,
    payload: GRNCreateFromPO,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("grn:create")),
) -> GRNResponse:
    return create_grn_from_po(db, po_id, payload, current_user.id)


@router.get("/grn", response_model=list[GRNResponse])
def list_grns(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> list[GRNResponse]:
    _ = current_user
    return db.query(GRN).options(selectinload(GRN.lines)).order_by(GRN.created_at.desc()).all()


@router.get("/grn/{grn_id}", response_model=GRNResponse)
def get_grn(
    grn_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> GRNResponse:
    _ = current_user
    record = db.query(GRN).options(selectinload(GRN.lines)).filter(GRN.id == grn_id).first()
    if not record:
        raise AppException(error_code="NOT_FOUND", message="GRN not found", status_code=404)
    return record


@router.post("/grn/{grn_id}/post", response_model=GRNResponse)
def post_grn_route(
    grn_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("grn:post")),
) -> GRNResponse:
    return post_grn(db, grn_id, current_user.id)
