from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.enums import PurchaseOrderStatus
from app.models.user import User
from app.reports.dead_stock import DeadStockReportFilters, get_dead_stock_report
from app.reports.expiry import ExpiryReportFilters, get_expiry_report
from app.reports.purchase_register import PurchaseRegisterFilters, get_purchase_register_report
from app.reports.stock_ageing import StockAgeingFilters, get_stock_ageing_report
from app.reports.stock_inward import StockInwardFilters, get_stock_inward_report
from app.reports.stock_movement import StockMovementFilters, get_stock_movement_report
from app.schemas.reports import (
    DeadStockReportResponse,
    ExpiryReportResponse,
    PurchaseRegisterReportResponse,
    StockAgeingReportResponse,
    StockInwardReportResponse,
    StockMovementReportResponse,
)

router = APIRouter()


@router.get("/expiry", response_model=ExpiryReportResponse)
def expiry_report(
    warehouse_id: int | None = None,
    product_id: int | None = None,
    expiry_within_days: int = Query(default=30, ge=0),
    include_expired: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> ExpiryReportResponse:
    _ = current_user
    filters = ExpiryReportFilters(
        warehouse_id=warehouse_id,
        product_id=product_id,
        expiry_within_days=expiry_within_days,
        include_expired=include_expired,
        page=page,
        page_size=page_size,
    )
    total, data = get_expiry_report(db, filters)
    return ExpiryReportResponse(total=total, page=page, page_size=page_size, data=data)


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


@router.get("/dead-stock", response_model=DeadStockReportResponse)
def dead_stock_report(
    warehouse_id: int | None = None,
    product_id: int | None = None,
    inactivity_days: int = Query(default=90, ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> DeadStockReportResponse:
    _ = current_user
    filters = DeadStockReportFilters(
        warehouse_id=warehouse_id,
        product_id=product_id,
        inactivity_days=inactivity_days,
        page=page,
        page_size=page_size,
    )
    total, data = get_dead_stock_report(db, filters)
    return DeadStockReportResponse(total=total, page=page, page_size=page_size, data=data)


@router.get("/stock-ageing", response_model=StockAgeingReportResponse)
def stock_ageing_report(
    warehouse_id: int | None = None,
    product_id: int | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> StockAgeingReportResponse:
    _ = current_user
    filters = StockAgeingFilters(
        warehouse_id=warehouse_id,
        product_id=product_id,
        page=page,
        page_size=page_size,
    )
    total, data = get_stock_ageing_report(db, filters)
    return StockAgeingReportResponse(total=total, page=page, page_size=page_size, data=data)
