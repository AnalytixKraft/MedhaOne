from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.enums import PurchaseOrderStatus
from app.models.user import User
from app.reports.purchase_register import PurchaseRegisterFilters, get_purchase_register_report
from app.reports.stock_inward import StockInwardFilters, get_stock_inward_report
from app.reports.stock_movement import StockMovementFilters, get_stock_movement_report
from app.schemas.reports import (
    PurchaseRegisterReportResponse,
    StockInwardReportResponse,
    StockMovementReportResponse,
)

router = APIRouter()


@router.get("/stock-inward", response_model=StockInwardReportResponse)
def stock_inward_report(
    date_from: date | None = None,
    date_to: date | None = None,
    supplier_id: int | None = None,
    warehouse_id: int | None = None,
    product_id: int | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> StockInwardReportResponse:
    _ = current_user
    filters = StockInwardFilters(
        date_from=date_from,
        date_to=date_to,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
        page=page,
        page_size=page_size,
    )
    total, data = get_stock_inward_report(db, filters)
    return StockInwardReportResponse(total=total, page=page, page_size=page_size, data=data)


@router.get("/purchase-register", response_model=PurchaseRegisterReportResponse)
def purchase_register_report(
    status: PurchaseOrderStatus | None = None,
    supplier_id: int | None = None,
    supplier_name: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> PurchaseRegisterReportResponse:
    _ = current_user
    filters = PurchaseRegisterFilters(
        status=status,
        supplier_id=supplier_id,
        supplier_name=supplier_name,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )
    total, data = get_purchase_register_report(db, filters)
    return PurchaseRegisterReportResponse(total=total, page=page, page_size=page_size, data=data)


@router.get("/stock-movement", response_model=StockMovementReportResponse)
def stock_movement_report(
    product_id: int | None = None,
    warehouse_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    movement_type: Literal["inward", "outward"] | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> StockMovementReportResponse:
    _ = current_user
    filters = StockMovementFilters(
        product_id=product_id,
        warehouse_id=warehouse_id,
        date_from=date_from,
        date_to=date_to,
        movement_type=movement_type,
        page=page,
        page_size=page_size,
    )
    total, data = get_stock_movement_report(db, filters)
    return StockMovementReportResponse(total=total, page=page, page_size=page_size, data=data)
