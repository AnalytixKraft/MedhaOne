from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.purchase import GRN, PurchaseOrder
from app.schemas.purchase import (
    GRNCreateFromPO,
    GRNResponse,
    PurchaseOrderCreate,
    PurchaseOrderList,
    PurchaseOrderResponse,
)
from app.services.purchase import (
    PurchaseError,
    approve_po,
    create_grn_from_po,
    create_po,
    post_grn,
)

router = APIRouter()


@router.post("/po", response_model=PurchaseOrderResponse, status_code=status.HTTP_201_CREATED)
def create_purchase_order(
    payload: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> PurchaseOrderResponse:
    try:
        return create_po(db, payload, current_user.id)
    except PurchaseError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error


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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found"
        )
    return record


@router.post("/po/{po_id}/approve", response_model=PurchaseOrderResponse)
def approve_purchase_order(
    po_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> PurchaseOrderResponse:
    try:
        return approve_po(db, po_id, current_user.id)
    except PurchaseError as error:
        message = str(error)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error


@router.post(
    "/grn/from-po/{po_id}", response_model=GRNResponse, status_code=status.HTTP_201_CREATED
)
def create_grn(
    po_id: int,
    payload: GRNCreateFromPO,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> GRNResponse:
    try:
        return create_grn_from_po(db, po_id, payload, current_user.id)
    except PurchaseError as error:
        message = str(error)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in message.lower() else 400
        raise HTTPException(status_code=status_code, detail=message) from error


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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="GRN not found")
    return record


@router.post("/grn/{grn_id}/post", response_model=GRNResponse)
def post_grn_route(
    grn_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> GRNResponse:
    try:
        return post_grn(db, grn_id, current_user.id)
    except PurchaseError as error:
        message = str(error)
        lowered = message.lower()
        status_code = (
            status.HTTP_404_NOT_FOUND if "not found" in lowered else status.HTTP_400_BAD_REQUEST
        )
        if "already posted" in lowered:
            status_code = status.HTTP_409_CONFLICT
        raise HTTPException(status_code=status_code, detail=message) from error
