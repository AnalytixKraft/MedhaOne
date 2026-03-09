from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.batch import Batch
from app.models.enums import PartyCategory, PartyType
from app.models.enums import PurchaseOrderStatus
from app.models.party import Party
from app.models.product import Product
from app.models.user import User
from app.models.warehouse import Warehouse
from app.reports.current_stock import CurrentStockFilters, get_current_stock_report
from app.reports.data_quality.common import DataQualityReportFilters
from app.reports.data_quality.compliance_gaps import get_compliance_gaps_report
from app.reports.data_quality.duplicate_masters import get_duplicate_masters_report
from app.reports.data_quality.invalid_references import get_invalid_references_report
from app.reports.data_quality.missing_fields import get_missing_fields_report
from app.reports.dead_stock import DeadStockReportFilters, get_dead_stock_report
from app.reports.expiry import ExpiryReportFilters, get_expiry_report
from app.reports.masters.brand_item_report import get_brand_item_report
from app.reports.masters.brand_summary_report import get_brand_summary_report
from app.reports.masters.category_item_report import get_category_item_report
from app.reports.masters.category_summary_report import get_category_summary_report
from app.reports.masters.common import MasterReportFilters
from app.reports.masters.inactive_items import get_inactive_items_report
from app.reports.masters.inactive_parties import get_inactive_parties_report
from app.reports.masters.inactive_warehouses import get_inactive_warehouses_report
from app.reports.masters.item_distribution import get_item_distribution_report
from app.reports.masters.item_utilization import get_item_utilization_report
from app.reports.masters.low_usage_unused_warehouses import get_low_usage_unused_warehouses_report
from app.reports.masters.party_activity_report import get_party_activity_report
from app.reports.masters.party_commercial_report import get_party_commercial_report
from app.reports.masters.party_geography_report import get_party_geography_report
from app.reports.masters.party_type_report import get_party_type_report
from app.reports.masters.warehouse_coverage import get_warehouse_coverage_report
from app.reports.masters.warehouse_item_summary import get_warehouse_item_summary_report
from app.reports.masters.warehouse_utilization import get_warehouse_utilization_report
from app.reports.opening_stock import OpeningStockFilters, get_opening_stock_report
from app.reports.purchase_register import PurchaseRegisterFilters, get_purchase_register_report
from app.reports.stock_ageing import StockAgeingFilters, get_stock_ageing_report
from app.reports.stock_inward import StockInwardFilters, get_stock_inward_report
from app.reports.stock_movement import StockMovementFilters, get_stock_movement_report
from app.reports.stock_source_traceability import (
    StockSourceTraceabilityFilters,
    get_current_stock_source_detail,
    get_stock_source_traceability_report,
)
from app.schemas.reports import (
    CurrentStockSourceDetailResponse,
    CurrentStockReportResponse,
    DataQualityFilterOptionsResponse,
    DeadStockReportResponse,
    ExpiryReportResponse,
    GenericTabularReportResponse,
    MasterReportFilterOptionsResponse,
    OpeningStockReportResponse,
    PurchaseRegisterReportResponse,
    ReportEntityOption,
    ReportSummaryMetric,
    ReportFilterOptionsResponse,
    StockAgeingReportResponse,
    StockInwardReportResponse,
    StockMovementReportResponse,
    StockSourceTraceabilityReportResponse,
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


def _parse_bool(value: str | None) -> bool | None:
    if value is None or value == "":
        return None
    normalized = value.strip().lower()
    if normalized in {"active", "true", "1", "yes"}:
        return True
    if normalized in {"inactive", "false", "0", "no"}:
        return False
    return None


def _master_filters(
    *,
    warehouse_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    product_ids: str | None = None,
    party_types: str | None = None,
    party_categories: str | None = None,
    states: str | None = None,
    cities: str | None = None,
    active_status: str | None = None,
    inactivity_days: int = 30,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = 1,
    page_size: int = 50,
) -> MasterReportFilters:
    return MasterReportFilters(
        warehouse_ids=_parse_csv_ints(warehouse_ids),
        brand_values=_parse_csv_strings(brand_values),
        category_values=_parse_csv_strings(category_values),
        product_ids=_parse_csv_ints(product_ids),
        party_types=_parse_csv_strings(party_types),
        party_categories=_parse_csv_strings(party_categories),
        states=_parse_csv_strings(states),
        cities=_parse_csv_strings(cities),
        is_active=_parse_bool(active_status),
        inactivity_days=inactivity_days,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )


def _dq_filters(
    *,
    entity_types: str | None = None,
    missing_field_type: str | None = None,
    duplicate_type: str | None = None,
    compliance_type: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> DataQualityReportFilters:
    return DataQualityReportFilters(
        entity_types=_parse_csv_strings(entity_types),
        missing_field_type=missing_field_type,
        duplicate_type=duplicate_type,
        compliance_type=compliance_type,
        page=page,
        page_size=page_size,
    )


def _generic_response(
    *,
    total: int,
    page: int,
    page_size: int,
    summary: list[dict],
    data: list[dict],
) -> GenericTabularReportResponse:
    return GenericTabularReportResponse(
        total=total,
        page=page,
        page_size=page_size,
        summary=[ReportSummaryMetric(**item) for item in summary],
        data=data,
    )


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


@router.get("/masters/filter-options", response_model=MasterReportFilterOptionsResponse)
def master_report_filter_options(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> MasterReportFilterOptionsResponse:
    _ = current_user
    base = report_filter_options(db=db, current_user=current_user)
    states = db.execute(
        select(Party.state).where(Party.state.isnot(None)).distinct().order_by(Party.state.asc())
    ).scalars()
    cities = db.execute(
        select(Party.city).where(Party.city.isnot(None)).distinct().order_by(Party.city.asc())
    ).scalars()
    return MasterReportFilterOptionsResponse(
        **base.model_dump(),
        party_types=[member.value for member in PartyType],
        party_categories=[member.value for member in PartyCategory],
        states=[value for value in states if value],
        cities=[value for value in cities if value],
    )


@router.get("/data-quality/filter-options", response_model=DataQualityFilterOptionsResponse)
def data_quality_filter_options(
    current_user: User = Depends(require_permission("reports:view")),
) -> DataQualityFilterOptionsResponse:
    _ = current_user
    return DataQualityFilterOptionsResponse(
        entity_types=["PARTY", "PRODUCT", "WAREHOUSE", "PURCHASE_ORDER", "PURCHASE_BILL", "STOCK_SUMMARY"],
        missing_field_types=["gstin", "state", "contact_person", "brand", "category", "gst_rate", "address"],
        duplicate_types=["party_gstin", "product_name", "warehouse_name"],
        compliance_types=["missing_gstin", "missing_pan", "missing_drug_license", "missing_fssai"],
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


@router.get(
    "/stock-source-traceability",
    response_model=StockSourceTraceabilityReportResponse,
)
def stock_source_traceability_report(
    date_from: date | None = None,
    date_to: date | None = None,
    supplier_id: int | None = None,
    supplier_ids: str | None = None,
    warehouse_id: int | None = None,
    warehouse_ids: str | None = None,
    product_id: int | None = None,
    product_ids: str | None = None,
    batch_nos: str | None = None,
    po_number: str | None = None,
    grn_number: str | None = None,
    bill_number: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> StockSourceTraceabilityReportResponse:
    _ = current_user
    filters = StockSourceTraceabilityFilters(
        date_from=date_from,
        date_to=date_to,
        supplier_ids=_merge_single_int(supplier_id, _parse_csv_ints(supplier_ids)),
        warehouse_ids=_merge_single_int(warehouse_id, _parse_csv_ints(warehouse_ids)),
        product_ids=_merge_single_int(product_id, _parse_csv_ints(product_ids)),
        batch_nos=_parse_csv_strings(batch_nos),
        po_number=po_number,
        grn_number=grn_number,
        bill_number=bill_number,
        page=page,
        page_size=page_size,
    )
    total, data = get_stock_source_traceability_report(db, filters)
    return StockSourceTraceabilityReportResponse(
        total=total,
        page=page,
        page_size=page_size,
        data=data,
    )


@router.get("/masters/warehouse-item-summary", response_model=GenericTabularReportResponse)
def masters_warehouse_item_summary(
    warehouse_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    active_status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        warehouse_ids=warehouse_ids,
        brand_values=brand_values,
        category_values=category_values,
        active_status=active_status,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_warehouse_item_summary_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/warehouse-utilization", response_model=GenericTabularReportResponse)
def masters_warehouse_utilization(
    warehouse_ids: str | None = None,
    active_status: str | None = None,
    inactivity_days: int = Query(default=30, ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        warehouse_ids=warehouse_ids,
        active_status=active_status,
        inactivity_days=inactivity_days,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_warehouse_utilization_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/warehouse-coverage", response_model=GenericTabularReportResponse)
def masters_warehouse_coverage(
    warehouse_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        warehouse_ids=warehouse_ids,
        brand_values=brand_values,
        category_values=category_values,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_warehouse_coverage_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/brand-item-report", response_model=GenericTabularReportResponse)
def masters_brand_item_report(
    warehouse_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    active_status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        warehouse_ids=warehouse_ids,
        brand_values=brand_values,
        category_values=category_values,
        active_status=active_status,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_brand_item_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/category-item-report", response_model=GenericTabularReportResponse)
def masters_category_item_report(
    warehouse_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        warehouse_ids=warehouse_ids,
        brand_values=brand_values,
        category_values=category_values,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_category_item_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/item-utilization", response_model=GenericTabularReportResponse)
def masters_item_utilization(
    warehouse_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    product_ids: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        warehouse_ids=warehouse_ids,
        brand_values=brand_values,
        category_values=category_values,
        product_ids=product_ids,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_item_utilization_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/item-distribution", response_model=GenericTabularReportResponse)
def masters_item_distribution(
    warehouse_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    product_ids: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        warehouse_ids=warehouse_ids,
        brand_values=brand_values,
        category_values=category_values,
        product_ids=product_ids,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_item_distribution_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/party-type-report", response_model=GenericTabularReportResponse)
def masters_party_type_report(
    party_types: str | None = None,
    party_categories: str | None = None,
    states: str | None = None,
    active_status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        party_types=party_types,
        party_categories=party_categories,
        states=states,
        active_status=active_status,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_party_type_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/party-geography-report", response_model=GenericTabularReportResponse)
def masters_party_geography_report(
    party_types: str | None = None,
    party_categories: str | None = None,
    states: str | None = None,
    cities: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        party_types=party_types,
        party_categories=party_categories,
        states=states,
        cities=cities,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_party_geography_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/party-commercial-report", response_model=GenericTabularReportResponse)
def masters_party_commercial_report(
    party_types: str | None = None,
    party_categories: str | None = None,
    states: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        party_types=party_types,
        party_categories=party_categories,
        states=states,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_party_commercial_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/party-activity-report", response_model=GenericTabularReportResponse)
def masters_party_activity_report(
    party_types: str | None = None,
    party_categories: str | None = None,
    states: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        party_types=party_types,
        party_categories=party_categories,
        states=states,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_party_activity_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/brand-summary-report", response_model=GenericTabularReportResponse)
def masters_brand_summary_report(
    warehouse_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        warehouse_ids=warehouse_ids,
        brand_values=brand_values,
        category_values=category_values,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_brand_summary_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/category-summary-report", response_model=GenericTabularReportResponse)
def masters_category_summary_report(
    warehouse_ids: str | None = None,
    brand_values: str | None = None,
    category_values: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        warehouse_ids=warehouse_ids,
        brand_values=brand_values,
        category_values=category_values,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_category_summary_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/inactive-parties", response_model=GenericTabularReportResponse)
def masters_inactive_parties(
    states: str | None = None,
    cities: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(states=states, cities=cities, page=page, page_size=page_size)
    total, data, summary = get_inactive_parties_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/inactive-items", response_model=GenericTabularReportResponse)
def masters_inactive_items(
    brand_values: str | None = None,
    category_values: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(brand_values=brand_values, category_values=category_values, page=page, page_size=page_size)
    total, data, summary = get_inactive_items_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/inactive-warehouses", response_model=GenericTabularReportResponse)
def masters_inactive_warehouses(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(page=page, page_size=page_size)
    total, data, summary = get_inactive_warehouses_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/masters/low-usage-unused-warehouses", response_model=GenericTabularReportResponse)
def masters_low_usage_unused_warehouses(
    warehouse_ids: str | None = None,
    inactivity_days: int = Query(default=30, ge=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _master_filters(
        warehouse_ids=warehouse_ids,
        inactivity_days=inactivity_days,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_low_usage_unused_warehouses_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/data-quality/missing-fields", response_model=GenericTabularReportResponse)
def data_quality_missing_fields(
    entity_types: str | None = None,
    missing_field_type: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _dq_filters(
        entity_types=entity_types,
        missing_field_type=missing_field_type,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_missing_fields_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/data-quality/duplicate-masters", response_model=GenericTabularReportResponse)
def data_quality_duplicate_masters(
    entity_types: str | None = None,
    duplicate_type: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _dq_filters(
        entity_types=entity_types,
        duplicate_type=duplicate_type,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_duplicate_masters_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/data-quality/compliance-gaps", response_model=GenericTabularReportResponse)
def data_quality_compliance_gaps(
    entity_types: str | None = None,
    compliance_type: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _dq_filters(
        entity_types=entity_types,
        compliance_type=compliance_type,
        page=page,
        page_size=page_size,
    )
    total, data, summary = get_compliance_gaps_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


@router.get("/data-quality/invalid-references", response_model=GenericTabularReportResponse)
def data_quality_invalid_references(
    entity_types: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> GenericTabularReportResponse:
    _ = current_user
    filters = _dq_filters(entity_types=entity_types, page=page, page_size=page_size)
    total, data, summary = get_invalid_references_report(db, filters)
    return _generic_response(total=total, page=page, page_size=page_size, summary=summary, data=data)


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


@router.get(
    "/current-stock/source-details",
    response_model=CurrentStockSourceDetailResponse,
)
def current_stock_source_details(
    warehouse_id: int,
    product_id: int,
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("reports:view")),
) -> CurrentStockSourceDetailResponse:
    _ = current_user
    detail = get_current_stock_source_detail(
        db,
        warehouse_id=warehouse_id,
        product_id=product_id,
        batch_id=batch_id,
    )
    if detail is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Stock source detail not found")
    return CurrentStockSourceDetailResponse(**detail)
