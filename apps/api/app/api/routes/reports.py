from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.batch import Batch
from app.models.enums import PurchaseOrderStatus
from app.models.party import Party
from app.models.product import Product
from app.models.user import User
from app.models.warehouse import Warehouse
from app.reports.current_stock import CurrentStockFilters, get_current_stock_report
from app.reports.dead_stock import DeadStockReportFilters, get_dead_stock_report
from app.reports.expiry import ExpiryReportFilters, get_expiry_report
from app.reports.opening_stock import OpeningStockFilters, get_opening_stock_report
from app.reports.purchase_register import PurchaseRegisterFilters, get_purchase_register_report
from app.reports.stock_ageing import StockAgeingFilters, get_stock_ageing_report
from app.reports.stock_inward import StockInwardFilters, get_stock_inward_report
from app.reports.stock_movement import StockMovementFilters, get_stock_movement_report
from app.schemas.reports import (
    CurrentStockReportResponse,
    DeadStockReportResponse,
    ExpiryReportResponse,
    OpeningStockReportResponse,
    PurchaseRegisterReportResponse,
    ReportEntityOption,
    ReportFilterOptionsResponse,
    StockAgeingReportResponse,
    StockInwardReportResponse,
    StockMovementReportResponse,
)

router = APIRouter()


def _parse_csv_ints(raw: str | None) -> tuple[int, ...]:
    if not raw:
        return ()

    values: list[int] = []
    for part in raw.split(","):
        token = part.strip()
        if not token:
            continue
        try:
            values.append(int(token))
        except ValueError:
            continue
    return tuple(dict.fromkeys(values))


def _parse_csv_strings(raw: str | None) -> tuple[str, ...]:
    if not raw:
        return ()
    values = [part.strip() for part in raw.split(",") if part.strip()]
    return tuple(dict.fromkeys(values))


def _merge_single_int(single_value: int | None, many_values: tuple[int, ...]) -> tuple[int, ...]:
    if single_value is None:
        return many_values
    if single_value in many_values:
        return many_values
    return (single_value, *many_values)


@router.get("/filter-options", response_model=ReportFilterOptionsResponse)
def report_filter_options(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> ReportFilterOptionsResponse:
    _ = current_user

    products = db.execute(
        select(Product.id, Product.name, Product.sku).order_by(Product.name.asc())
    ).all()
    suppliers = db.execute(select(Party.id, Party.name).order_by(Party.name.asc())).all()
    warehouses = db.execute(
        select(Warehouse.id, Warehouse.name).order_by(Warehouse.name.asc())
    ).all()
    brands = db.execute(
        select(Product.brand)
        .where(Product.brand.isnot(None))
        .distinct()
        .order_by(Product.brand.asc())
    ).scalars()
    categories = db.execute(
        select(Product.hsn)
        .where(Product.hsn.isnot(None))
        .distinct()
        .order_by(Product.hsn.asc())
    ).scalars()
    batches = db.execute(
        select(Batch.batch_no).distinct().order_by(Batch.batch_no.asc()).limit(500)
    ).scalars()

    return ReportFilterOptionsResponse(
        brands=[value for value in brands if value],
        categories=[value for value in categories if value],
        batches=[value for value in batches if value],
        products=[
            ReportEntityOption(id=row.id, label=f"{row.name} ({row.sku})")
            for row in products
        ],
        suppliers=[ReportEntityOption(id=row.id, label=row.name) for row in suppliers],
        warehouses=[ReportEntityOption(id=row.id, label=row.name) for row in warehouses],
    )


@router.get("/expiry", response_model=ExpiryReportResponse)
def expiry_report(
    warehouse_id: int | None = None,
    product_id: int | None = None,
    warehouse_ids: str | None = None,
    product_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    batch_nos: str | None = None,
    expiry_status: Literal["all", "expiring_30", "expired", "safe"] | None = None,
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
        warehouse_ids=_merge_single_int(warehouse_id, _parse_csv_ints(warehouse_ids)),
        product_id=product_id,
        product_ids=_merge_single_int(product_id, _parse_csv_ints(product_ids)),
        brand_values=_parse_csv_strings(brand_values),
        category_values=_parse_csv_strings(category_values),
        batch_nos=_parse_csv_strings(batch_nos),
        expiry_status=None if expiry_status in (None, "all") else expiry_status,
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
    supplier_ids: str | None = None,
    warehouse_id: int | None = None,
    warehouse_ids: str | None = None,
    product_id: int | None = None,
    product_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    batch_nos: str | None = None,
    expiry_status: Literal["all", "expiring_30", "expired", "safe"] | None = None,
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
        supplier_ids=_merge_single_int(supplier_id, _parse_csv_ints(supplier_ids)),
        warehouse_id=warehouse_id,
        warehouse_ids=_merge_single_int(warehouse_id, _parse_csv_ints(warehouse_ids)),
        product_id=product_id,
        product_ids=_merge_single_int(product_id, _parse_csv_ints(product_ids)),
        brand_values=_parse_csv_strings(brand_values),
        category_values=_parse_csv_strings(category_values),
        batch_nos=_parse_csv_strings(batch_nos),
        expiry_status=None if expiry_status in (None, "all") else expiry_status,
        page=page,
        page_size=page_size,
    )
    total, data = get_stock_inward_report(db, filters)
    return StockInwardReportResponse(total=total, page=page, page_size=page_size, data=data)


@router.get("/purchase-register", response_model=PurchaseRegisterReportResponse)
def purchase_register_report(
    status: PurchaseOrderStatus | None = None,
    supplier_id: int | None = None,
    supplier_ids: str | None = None,
    warehouse_ids: str | None = None,
    product_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
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
        supplier_ids=_merge_single_int(supplier_id, _parse_csv_ints(supplier_ids)),
        warehouse_ids=_parse_csv_ints(warehouse_ids),
        product_ids=_parse_csv_ints(product_ids),
        brand_values=_parse_csv_strings(brand_values),
        category_values=_parse_csv_strings(category_values),
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
    product_ids: str | None = None,
    warehouse_id: int | None = None,
    warehouse_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    batch_nos: str | None = None,
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
        product_ids=_merge_single_int(product_id, _parse_csv_ints(product_ids)),
        warehouse_id=warehouse_id,
        warehouse_ids=_merge_single_int(warehouse_id, _parse_csv_ints(warehouse_ids)),
        brand_values=_parse_csv_strings(brand_values),
        category_values=_parse_csv_strings(category_values),
        batch_nos=_parse_csv_strings(batch_nos),
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
    warehouse_ids: str | None = None,
    product_id: int | None = None,
    product_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    inactivity_days: int = Query(default=90, ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> DeadStockReportResponse:
    _ = current_user
    filters = DeadStockReportFilters(
        warehouse_id=warehouse_id,
        warehouse_ids=_merge_single_int(warehouse_id, _parse_csv_ints(warehouse_ids)),
        product_id=product_id,
        product_ids=_merge_single_int(product_id, _parse_csv_ints(product_ids)),
        brand_values=_parse_csv_strings(brand_values),
        category_values=_parse_csv_strings(category_values),
        inactivity_days=inactivity_days,
        page=page,
        page_size=page_size,
    )
    total, data = get_dead_stock_report(db, filters)
    return DeadStockReportResponse(total=total, page=page, page_size=page_size, data=data)


@router.get("/stock-ageing", response_model=StockAgeingReportResponse)
def stock_ageing_report(
    warehouse_id: int | None = None,
    warehouse_ids: str | None = None,
    product_id: int | None = None,
    product_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> StockAgeingReportResponse:
    _ = current_user
    filters = StockAgeingFilters(
        warehouse_id=warehouse_id,
        warehouse_ids=_merge_single_int(warehouse_id, _parse_csv_ints(warehouse_ids)),
        product_id=product_id,
        product_ids=_merge_single_int(product_id, _parse_csv_ints(product_ids)),
        brand_values=_parse_csv_strings(brand_values),
        category_values=_parse_csv_strings(category_values),
        page=page,
        page_size=page_size,
    )
    total, data = get_stock_ageing_report(db, filters)
    return StockAgeingReportResponse(total=total, page=page, page_size=page_size, data=data)


@router.get("/opening-stock", response_model=OpeningStockReportResponse)
def opening_stock_report(
    brand_values: str | None = None,
    category_values: str | None = None,
    product_ids: str | None = None,
    warehouse_ids: str | None = None,
    batch_nos: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> OpeningStockReportResponse:
    _ = current_user
    filters = OpeningStockFilters(
        brand_values=_parse_csv_strings(brand_values),
        category_values=_parse_csv_strings(category_values),
        product_ids=_parse_csv_ints(product_ids),
        warehouse_ids=_parse_csv_ints(warehouse_ids),
        batch_nos=_parse_csv_strings(batch_nos),
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_opening_stock_report(db, filters)
    return OpeningStockReportResponse(
        total=total,
        page=page,
        page_size=page_size,
        summary=summary,
        data=data,
    )


@router.get("/current-stock", response_model=CurrentStockReportResponse)
def current_stock_report(
    brand_values: str | None = None,
    category_values: str | None = None,
    product_ids: str | None = None,
    warehouse_ids: str | None = None,
    batch_nos: str | None = None,
    expiry_from: date | None = None,
    expiry_to: date | None = None,
    expiry_status: Literal["all", "expiring_30", "expired", "safe"] | None = None,
    stock_status: Literal["all", "available", "zero", "negative"] | None = None,
    stock_source: Literal["all", "opening", "non_opening"] | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> CurrentStockReportResponse:
    _ = current_user
    filters = CurrentStockFilters(
        brand_values=_parse_csv_strings(brand_values),
        category_values=_parse_csv_strings(category_values),
        product_ids=_parse_csv_ints(product_ids),
        warehouse_ids=_parse_csv_ints(warehouse_ids),
        batch_nos=_parse_csv_strings(batch_nos),
        expiry_from=expiry_from,
        expiry_to=expiry_to,
        expiry_status=None if expiry_status in (None, "all") else expiry_status,
        stock_status=None if stock_status in (None, "all") else stock_status,
        stock_source=None if stock_source in (None, "all") else stock_source,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_current_stock_report(db, filters)
    return CurrentStockReportResponse(
        total=total,
        page=page,
        page_size=page_size,
        summary=summary,
        data=data,
    )
