from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.schemas.inventory import (
    InventoryActionResponse,
    InventoryAdjustRequest,
    InventoryInRequest,
    InventoryOutRequest,
)
from app.services.inventory import InventoryError, stock_adjust, stock_in, stock_out

router = APIRouter()


@router.post("/in", response_model=InventoryActionResponse)
def create_stock_in(
    payload: InventoryInRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> InventoryActionResponse:
    try:
        result = stock_in(
            db,
            warehouse_id=payload.warehouse_id,
            product_id=payload.product_id,
            batch_id=payload.batch_id,
            qty=payload.qty,
            reason=payload.reason,
            created_by=current_user.id,
            ref_type=payload.ref_type,
            ref_id=payload.ref_id,
        )
    except InventoryError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    return InventoryActionResponse(
        ledger_id=result.ledger.id,
        txn_type=result.ledger.txn_type,
        qty=result.ledger.qty,
        qty_on_hand=result.summary.qty_on_hand,
        created_at=result.ledger.created_at,
    )


@router.post("/out", response_model=InventoryActionResponse)
def create_stock_out(
    payload: InventoryOutRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> InventoryActionResponse:
    try:
        result = stock_out(
            db,
            warehouse_id=payload.warehouse_id,
            product_id=payload.product_id,
            batch_id=payload.batch_id,
            qty=payload.qty,
            reason=payload.reason,
            created_by=current_user.id,
            ref_type=payload.ref_type,
            ref_id=payload.ref_id,
        )
    except InventoryError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    return InventoryActionResponse(
        ledger_id=result.ledger.id,
        txn_type=result.ledger.txn_type,
        qty=result.ledger.qty,
        qty_on_hand=result.summary.qty_on_hand,
        created_at=result.ledger.created_at,
    )


@router.post("/adjust", response_model=InventoryActionResponse)
def create_stock_adjust(
    payload: InventoryAdjustRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> InventoryActionResponse:
    try:
        result = stock_adjust(
            db,
            warehouse_id=payload.warehouse_id,
            product_id=payload.product_id,
            batch_id=payload.batch_id,
            delta_qty=payload.delta_qty,
            reason=payload.reason,
            created_by=current_user.id,
        )
    except InventoryError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    return InventoryActionResponse(
        ledger_id=result.ledger.id,
        txn_type=result.ledger.txn_type,
        qty=result.ledger.qty,
        qty_on_hand=result.summary.qty_on_hand,
        created_at=result.ledger.created_at,
    )
