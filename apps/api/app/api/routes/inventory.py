import csv
import io
import logging
from datetime import date
from decimal import Decimal, InvalidOperation
from uuid import uuid4

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import IS_POSTGRES, get_db, set_tenant_search_path
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.models.batch import Batch
from app.models.enums import InventoryReason, StockAdjustmentReason, StockAdjustmentType
from app.models.inventory import StockSummary
from app.models.product import Product
from app.models.stock_operations import StockAdjustment, StockCorrection
from app.models.user import User
from app.models.warehouse import Warehouse
from app.schemas.masters import BulkImportError, BulkImportResult
from app.schemas.inventory import (
    InventoryActionResponse,
    InventoryAdjustRequest,
    InventoryInRequest,
    InventoryOutRequest,
    StockAdjustmentCreateRequest,
    StockAdjustmentListResponse,
    StockAdjustmentResponse,
    StockCorrectionRequest,
    StockCorrectionListResponse,
    StockCorrectionResponse,
    StockItemListResponse,
)
from app.services.audit import snapshot_model, write_audit_log
from app.services.inventory import stock_adjust, stock_in, stock_out

router = APIRouter()
logger = logging.getLogger(__name__)


def _commit_with_tenant_context(db: Session) -> None:
    db.commit()
    tenant_schema = db.info.get("tenant_schema")
    if isinstance(tenant_schema, str) and tenant_schema:
        set_tenant_search_path(db, tenant_schema)


def _tenant_table_exists(db: Session, schema_name: str, table_name: str) -> bool:
    return (
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = :schema_name
                  AND table_name = :table_name
                """
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).scalar_one_or_none()
        is not None
    )


def _tenant_column_exists(db: Session, schema_name: str, table_name: str, column_name: str) -> bool:
    return (
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = :table_name
                  AND column_name = :column_name
                """
            ),
            {"schema_name": schema_name, "table_name": table_name, "column_name": column_name},
        ).scalar_one_or_none()
        is not None
    )


def _ensure_stock_ops_schema_ready(db: Session) -> None:
    if not IS_POSTGRES:
        return
    tenant_schema = db.info.get("tenant_schema")
    if not isinstance(tenant_schema, str) or not tenant_schema or tenant_schema == "public":
        return

    missing_stock_corrections = not _tenant_table_exists(db, tenant_schema, "stock_corrections")
    missing_stock_adjustments = not _tenant_table_exists(db, tenant_schema, "stock_adjustments")
    missing_audit_module = not _tenant_column_exists(db, tenant_schema, "audit_logs", "module")

    if not (missing_stock_corrections or missing_stock_adjustments or missing_audit_module):
        return

    logger.warning(
        "Tenant schema missing stock operation compatibility",
        extra={
            "schema": tenant_schema,
            "missing_stock_corrections": missing_stock_corrections,
            "missing_stock_adjustments": missing_stock_adjustments,
            "missing_audit_module": missing_audit_module,
        },
    )
    raise AppException(
        error_code="TENANT_SCHEMA_INCOMPATIBLE",
        message=(
            "Tenant inventory schema is outdated for stock operations. "
            "Run tenant schema migrations to enable stock correction and stock adjustment."
        ),
        status_code=status.HTTP_409_CONFLICT,
        details={
            "schema": tenant_schema,
            "missing_stock_corrections": missing_stock_corrections,
            "missing_stock_adjustments": missing_stock_adjustments,
            "missing_audit_module": missing_audit_module,
        },
    )


def _parse_csv_rows(csv_data: str) -> list[dict[str, str]]:
    if not csv_data.strip():
        return []

    reader = csv.DictReader(io.StringIO(csv_data))
    if not reader.fieldnames:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="CSV header row is required",
        )

    rows: list[dict[str, str]] = []
    for row in reader:
        normalized_row = {
            str(key).strip(): (value or "").strip()
            for key, value in row.items()
            if key is not None and str(key).strip()
        }
        if not any(normalized_row.values()):
            continue
        rows.append(normalized_row)
    return rows


async def _read_bulk_rows(request: Request) -> list[dict]:
    content_type = (request.headers.get("content-type") or "").lower()

    if "application/json" in content_type:
        payload = await request.json()
        if isinstance(payload, list):
            if not all(isinstance(item, dict) for item in payload):
                raise AppException(
                    error_code="VALIDATION_ERROR",
                    message="Bulk payload must be an array of objects",
                )
            return payload
        if isinstance(payload, dict):
            rows = payload.get("rows")
            if isinstance(rows, list):
                if not all(isinstance(item, dict) for item in rows):
                    raise AppException(
                        error_code="VALIDATION_ERROR",
                        message="Bulk rows must be an array of objects",
                    )
                return rows
            csv_data = payload.get("csv_data")
            if isinstance(csv_data, str):
                return _parse_csv_rows(csv_data)
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Provide rows[] or csv_data in JSON payload",
        )

    if "text/csv" in content_type:
        return _parse_csv_rows((await request.body()).decode("utf-8-sig"))

    if "multipart/form-data" in content_type:
        form = await request.form()
        file_obj = form.get("file")
        if file_obj is None or not hasattr(file_obj, "read"):
            raise AppException(
                error_code="VALIDATION_ERROR",
                message="Multipart upload requires a file field named 'file'",
            )
        raw = await file_obj.read()
        return _parse_csv_rows(raw.decode("utf-8-sig"))

    raise AppException(
        error_code="VALIDATION_ERROR",
        message="Unsupported content type. Use JSON or CSV",
    )


def _bulk_error(row: int, message: str, field: str | None = None) -> BulkImportError:
    return BulkImportError(row=row, field=field, message=message)


def _to_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _parse_required_decimal(value: str, field: str, row_index: int) -> Decimal:
    try:
        parsed = Decimal(value)
    except (InvalidOperation, TypeError):
        raise AppException(
            error_code="VALIDATION_ERROR",
            message=f"{field} must be a valid number",
            status_code=400,
            details={"field": field, "row": row_index},
        )
    if parsed <= 0:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message=f"{field} must be greater than zero",
            status_code=400,
            details={"field": field, "row": row_index},
        )
    return parsed


def _parse_optional_decimal(value: str, field: str, row_index: int) -> Decimal | None:
    if not value:
        return None
    try:
        parsed = Decimal(value)
    except (InvalidOperation, TypeError):
        raise AppException(
            error_code="VALIDATION_ERROR",
            message=f"{field} must be a valid number",
            status_code=400,
            details={"field": field, "row": row_index},
        )
    if parsed < 0:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message=f"{field} cannot be negative",
            status_code=400,
            details={"field": field, "row": row_index},
        )
    return parsed


def _parse_date(value: str, field: str, row_index: int) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message=f"{field} must be in YYYY-MM-DD format",
            status_code=400,
            details={"field": field, "row": row_index},
        ) from error


def _parse_optional_date(value: str, field: str, row_index: int) -> date | None:
    if not value:
        return None
    return _parse_date(value, field, row_index)


def _normalized_reason_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _metadata_changed(source_batch: Batch, payload: StockCorrectionRequest) -> bool:
    if source_batch.batch_no != payload.corrected_batch_no:
        return True
    if source_batch.expiry_date != payload.corrected_expiry_date:
        return True
    if payload.corrected_mfg_date is not None and source_batch.mfg_date != payload.corrected_mfg_date:
        return True
    if payload.corrected_mrp is not None and source_batch.mrp != payload.corrected_mrp:
        return True
    if source_batch.reference_id != payload.corrected_reference_id:
        return True
    return False


def _get_or_create_corrected_batch(
    db: Session,
    *,
    source_batch: Batch,
    payload: StockCorrectionRequest,
) -> Batch:
    target_mfg = (
        payload.corrected_mfg_date
        if payload.corrected_mfg_date is not None
        else source_batch.mfg_date
    )
    target_mrp = payload.corrected_mrp if payload.corrected_mrp is not None else source_batch.mrp
    target_reference_id = payload.corrected_reference_id
    target_batch = (
        db.query(Batch)
        .filter(Batch.product_id == payload.product_id)
        .filter(Batch.batch_no == payload.corrected_batch_no)
        .filter(Batch.expiry_date == payload.corrected_expiry_date)
        .filter(Batch.mfg_date == target_mfg if target_mfg is not None else Batch.mfg_date.is_(None))
        .filter(Batch.mrp == target_mrp if target_mrp is not None else Batch.mrp.is_(None))
        .filter(
            Batch.reference_id == target_reference_id
            if target_reference_id is not None
            else Batch.reference_id.is_(None)
        )
        .first()
    )
    if target_batch is not None:
        return target_batch

    target_batch = Batch(
        product_id=payload.product_id,
        batch_no=payload.corrected_batch_no,
        expiry_date=payload.corrected_expiry_date,
        mfg_date=target_mfg,
        mrp=target_mrp,
        reference_id=target_reference_id,
    )
    db.add(target_batch)
    db.flush()
    return target_batch


@router.post("/in", response_model=InventoryActionResponse)
def create_stock_in(
    payload: InventoryInRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("inventory:in")),
) -> InventoryActionResponse:
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
    return InventoryActionResponse(
        ledger_id=result.ledger.id,
        txn_type=result.ledger.txn_type,
        qty=result.ledger.qty,
        qty_on_hand=result.summary.qty_on_hand,
        created_at=result.ledger.created_at,
    )


@router.post("/opening-stock/bulk", response_model=BulkImportResult)
async def bulk_upload_opening_stock(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("inventory:in")),
) -> BulkImportResult:
    rows = await _read_bulk_rows(request)
    errors: list[BulkImportError] = []
    created_count = 0

    products_by_sku = {
        product.sku.upper(): product
        for product in db.query(Product).filter(Product.is_active.is_(True)).all()
    }
    warehouses_by_code = {
        warehouse.code.upper(): warehouse
        for warehouse in db.query(Warehouse).filter(Warehouse.is_active.is_(True)).all()
    }
    batch_cache: dict[tuple[int, str, date, date | None, Decimal | None, str | None], Batch] = {}

    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            errors.append(_bulk_error(index, "Row must be an object"))
            continue

        sku = _to_text(row.get("sku") or row.get("product_sku")).upper()
        warehouse_code = _to_text(row.get("warehouse_code")).upper()
        batch_no = _to_text(row.get("batch_no"))
        expiry_date_raw = _to_text(row.get("expiry_date"))
        qty_raw = _to_text(row.get("qty") or row.get("opening_qty"))

        if not sku:
            errors.append(_bulk_error(index, "sku is required", "sku"))
            continue
        if not warehouse_code:
            errors.append(_bulk_error(index, "warehouse_code is required", "warehouse_code"))
            continue
        if not batch_no:
            errors.append(_bulk_error(index, "batch_no is required", "batch_no"))
            continue
        if not expiry_date_raw:
            errors.append(_bulk_error(index, "expiry_date is required", "expiry_date"))
            continue
        if not qty_raw:
            errors.append(_bulk_error(index, "qty is required", "qty"))
            continue

        product = products_by_sku.get(sku)
        if not product:
            errors.append(_bulk_error(index, "Product not found for SKU", "sku"))
            continue

        warehouse = warehouses_by_code.get(warehouse_code)
        if not warehouse:
            errors.append(_bulk_error(index, "Warehouse not found for code", "warehouse_code"))
            continue

        try:
            expiry_date = _parse_date(expiry_date_raw, "expiry_date", index)
            mfg_date = _parse_optional_date(_to_text(row.get("mfg_date")), "mfg_date", index)
            mrp = _parse_optional_decimal(_to_text(row.get("mrp")), "mrp", index)
            qty = _parse_required_decimal(qty_raw, "qty", index)
            batch_reference_id = _to_text(row.get("ref_id")) or None

            with db.begin_nested():
                cache_key = (product.id, batch_no, expiry_date, mfg_date, mrp, batch_reference_id)
                batch = batch_cache.get(cache_key)
                if batch is None:
                    batch = (
                        db.query(Batch)
                        .filter(Batch.product_id == product.id)
                        .filter(Batch.batch_no == batch_no)
                        .filter(Batch.expiry_date == expiry_date)
                        .filter(Batch.mfg_date == mfg_date if mfg_date is not None else Batch.mfg_date.is_(None))
                        .filter(Batch.mrp == mrp if mrp is not None else Batch.mrp.is_(None))
                        .filter(
                            Batch.reference_id == batch_reference_id
                            if batch_reference_id is not None
                            else Batch.reference_id.is_(None)
                        )
                        .first()
                    )
                    if batch is None:
                        batch = Batch(
                            product_id=product.id,
                            batch_no=batch_no,
                            expiry_date=expiry_date,
                            mfg_date=mfg_date,
                            mrp=mrp,
                            reference_id=batch_reference_id,
                        )
                        db.add(batch)
                        db.flush()
                    batch_cache[cache_key] = batch

                stock_in(
                    db,
                    warehouse_id=warehouse.id,
                    product_id=product.id,
                    batch_id=batch.id,
                    qty=qty,
                    reason=InventoryReason.OPENING_STOCK,
                    created_by=current_user.id,
                    ref_type="OPENING",
                    ref_id=batch_reference_id or f"BULK-OPENING-{index}",
                    commit=False,
                )
            created_count += 1
        except AppException as error:
            errors.append(
                _bulk_error(index, error.message, (error.details or {}).get("field"))
            )
        except Exception as error:
            errors.append(_bulk_error(index, str(error)))

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Failed to commit opening stock bulk upload",
            status_code=status.HTTP_400_BAD_REQUEST,
        ) from error

    return BulkImportResult(
        created_count=created_count,
        failed_count=len(errors),
        errors=errors,
    )


@router.get("/templates/opening-stock-import.csv")
def opening_stock_import_template(
    current_user: User = Depends(require_permission("inventory:view")),
) -> Response:
    _ = current_user
    csv_data = "\n".join(
        [
            "sku,warehouse_code,batch_no,expiry_date,qty,mfg_date,mrp,ref_id",
            "SKU001,MAIN,BATCH-A,2030-12-31,100,2026-01-01,125.50,OPENING-001",
            "SKU002,MAIN,BATCH-B,2031-03-31,45,,,OPENING-002",
        ]
    )
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="opening-stock-import.csv"'},
    )


@router.get("/stock-items", response_model=StockItemListResponse)
def list_stock_items(
    warehouse_id: int | None = None,
    product_id: int | None = None,
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("inventory:view")),
) -> StockItemListResponse:
    _ = current_user
    stmt = (
        select(
            StockSummary.warehouse_id.label("warehouse_id"),
            Warehouse.name.label("warehouse_name"),
            StockSummary.product_id.label("product_id"),
            Product.sku.label("sku"),
            Product.name.label("product_name"),
            Product.quantity_precision.label("quantity_precision"),
            StockSummary.batch_id.label("batch_id"),
            Batch.batch_no.label("batch_no"),
            Batch.expiry_date.label("expiry_date"),
            Batch.mfg_date.label("mfg_date"),
            Batch.mrp.label("mrp"),
            Batch.reference_id.label("reference_id"),
            StockSummary.qty_on_hand.label("qty_on_hand"),
        )
        .select_from(StockSummary)
        .join(Warehouse, Warehouse.id == StockSummary.warehouse_id)
        .join(Product, Product.id == StockSummary.product_id)
        .join(Batch, Batch.id == StockSummary.batch_id)
        .where(StockSummary.qty_on_hand > Decimal("0"))
    )

    if warehouse_id is not None:
        stmt = stmt.where(StockSummary.warehouse_id == warehouse_id)
    if product_id is not None:
        stmt = stmt.where(StockSummary.product_id == product_id)
    if search:
        normalized = search.strip().lower()
        if normalized:
            pattern = f"%{normalized}%"
            stmt = stmt.where(
                or_(
                    func.lower(Product.sku).like(pattern),
                    func.lower(Product.name).like(pattern),
                    func.lower(Batch.batch_no).like(pattern),
                    func.lower(Warehouse.name).like(pattern),
                )
            )

    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.execute(count_stmt).scalar_one())

    rows = db.execute(
        stmt.order_by(Product.name.asc(), Warehouse.name.asc(), Batch.expiry_date.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).mappings()

    data = [
        {
            "warehouse_id": row["warehouse_id"],
            "warehouse_name": row["warehouse_name"],
            "product_id": row["product_id"],
            "sku": row["sku"],
            "product_name": row["product_name"],
            "quantity_precision": row["quantity_precision"],
            "batch_id": row["batch_id"],
            "batch_no": row["batch_no"],
            "expiry_date": row["expiry_date"],
            "mfg_date": row["mfg_date"],
            "mrp": row["mrp"],
            "reference_id": row["reference_id"],
            "qty_on_hand": row["qty_on_hand"],
        }
        for row in rows
    ]

    return StockItemListResponse(total=total, page=page, page_size=page_size, data=data)


@router.get("/stock-corrections", response_model=StockCorrectionListResponse)
def list_stock_corrections(
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("stock_correction:view")),
) -> StockCorrectionListResponse:
    _ = current_user
    try:
        _ensure_stock_ops_schema_ready(db)
    except AppException as error:
        if error.error_code != "TENANT_SCHEMA_INCOMPATIBLE":
            raise
        return StockCorrectionListResponse(total=0, page=page, page_size=page_size, data=[])
    source_batch = Batch.__table__.alias("source_batch")
    corrected_batch = Batch.__table__.alias("corrected_batch")
    creator = User.__table__.alias("creator")
    stmt = (
        select(
            StockCorrection.id.label("id"),
            StockCorrection.reference_id.label("reference_id"),
            Product.name.label("product_name"),
            Product.sku.label("sku"),
            Warehouse.name.label("warehouse_name"),
            source_batch.c.batch_no.label("source_batch_no"),
            source_batch.c.expiry_date.label("source_expiry_date"),
            corrected_batch.c.batch_no.label("corrected_batch_no"),
            corrected_batch.c.expiry_date.label("corrected_expiry_date"),
            StockCorrection.qty.label("qty_to_reclassify"),
            StockCorrection.reason.label("reason"),
            StockCorrection.remarks.label("remarks"),
            creator.c.full_name.label("created_by_name"),
            StockCorrection.created_at.label("created_at"),
        )
        .select_from(StockCorrection)
        .join(Product, Product.id == StockCorrection.product_id)
        .join(Warehouse, Warehouse.id == StockCorrection.warehouse_id)
        .join(source_batch, source_batch.c.id == StockCorrection.source_batch_id)
        .join(corrected_batch, corrected_batch.c.id == StockCorrection.corrected_batch_id)
        .join(creator, creator.c.id == StockCorrection.created_by)
    )
    if search:
        normalized = search.strip().lower()
        if normalized:
            pattern = f"%{normalized}%"
            stmt = stmt.where(
                or_(
                    func.lower(Product.name).like(pattern),
                    func.lower(Product.sku).like(pattern),
                    func.lower(Warehouse.name).like(pattern),
                    func.lower(source_batch.c.batch_no).like(pattern),
                    func.lower(corrected_batch.c.batch_no).like(pattern),
                    func.lower(StockCorrection.reference_id).like(pattern),
                )
            )
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.execute(count_stmt).scalar_one())
    rows = db.execute(
        stmt.order_by(StockCorrection.created_at.desc(), StockCorrection.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).mappings()
    return StockCorrectionListResponse(
        total=total,
        page=page,
        page_size=page_size,
        data=[dict(row) for row in rows],
    )


@router.post("/stock-corrections", response_model=StockCorrectionResponse)
def create_stock_correction(
    payload: StockCorrectionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("stock_correction:apply")),
) -> StockCorrectionResponse:
    _ensure_stock_ops_schema_ready(db)
    source_batch = db.get(Batch, payload.source_batch_id)
    if not source_batch:
        raise AppException(
            error_code="NOT_FOUND",
            message="Source batch not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    if source_batch.product_id != payload.product_id:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Source batch does not belong to selected product",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    if not _metadata_changed(source_batch, payload):
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="At least one corrected metadata field must differ from the source batch.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    reference_id = payload.reference_id or f"SC-{uuid4().hex[:10].upper()}"

    try:
        corrected_batch = _get_or_create_corrected_batch(db, source_batch=source_batch, payload=payload)
        correction = StockCorrection(
            reference_id=reference_id,
            warehouse_id=payload.warehouse_id,
            product_id=payload.product_id,
            source_batch_id=payload.source_batch_id,
            corrected_batch_id=corrected_batch.id,
            qty=payload.qty_to_reclassify,
            reason=payload.reason,
            remarks=payload.remarks,
            created_by=current_user.id,
        )
        db.add(correction)
        db.flush()

        out_result = stock_out(
            db,
            warehouse_id=payload.warehouse_id,
            product_id=payload.product_id,
            batch_id=payload.source_batch_id,
            qty=payload.qty_to_reclassify,
            reason=InventoryReason.STOCK_CORRECTION_OUT,
            created_by=current_user.id,
            ref_type="STOCK_CORRECTION",
            ref_id=reference_id,
            commit=False,
        )
        in_result = stock_in(
            db,
            warehouse_id=payload.warehouse_id,
            product_id=payload.product_id,
            batch_id=corrected_batch.id,
            qty=payload.qty_to_reclassify,
            reason=InventoryReason.STOCK_CORRECTION_IN,
            created_by=current_user.id,
            ref_type="STOCK_CORRECTION",
            ref_id=reference_id,
            commit=False,
        )
        correction.out_ledger_id = out_result.ledger.id
        correction.in_ledger_id = in_result.ledger.id

        correction_after = snapshot_model(
            correction,
            fields=[
                "id",
                "reference_id",
                "warehouse_id",
                "product_id",
                "source_batch_id",
                "corrected_batch_id",
                "qty",
                "reason",
                "remarks",
                "out_ledger_id",
                "in_ledger_id",
                "created_by",
                "created_at",
            ],
        )
        source_before = snapshot_model(
            source_batch,
            fields=["id", "batch_no", "expiry_date", "mfg_date", "mrp", "reference_id"],
        )
        corrected_after = snapshot_model(
            corrected_batch,
            fields=["id", "batch_no", "expiry_date", "mfg_date", "mrp", "reference_id"],
        )
        write_audit_log(
            db,
            module="Stock Correction",
            action="CORRECT",
            entity_type="STOCK_CORRECTION",
            entity_id=correction.id,
            performed_by=current_user.id,
            summary=f"Reclassified {payload.qty_to_reclassify} from batch {source_batch.batch_no} to {corrected_batch.batch_no}",
            reason=payload.reason,
            remarks=payload.remarks,
            source_screen="Inventory / Stock Operations / Stock Correction",
            source_reference=reference_id,
            before_snapshot={
                "source_batch": source_before,
                "qty_on_hand": str(out_result.summary.qty_on_hand + payload.qty_to_reclassify),
            },
            after_snapshot={
                **correction_after,
                "source_qty_on_hand": str(out_result.summary.qty_on_hand),
                "corrected_qty_on_hand": str(in_result.summary.qty_on_hand),
                "corrected_batch": corrected_after,
            },
            metadata={
                "ledger_ids": [out_result.ledger.id, in_result.ledger.id],
                "net_stock_change": "0",
            },
        )
        write_audit_log(
            db,
            module="Inventory",
            action="CORRECT",
            entity_type="BATCH",
            entity_id=source_batch.id,
            performed_by=current_user.id,
            summary=f"Stock reclassified out via {reference_id}",
            reason=payload.reason,
            remarks=payload.remarks,
            source_screen="Inventory / Stock Operations / Stock Correction",
            source_reference=reference_id,
            before_snapshot=source_before,
            after_snapshot=source_before,
            metadata={
                "direction": "OUT",
                "qty": str(payload.qty_to_reclassify),
                "stock_correction_id": correction.id,
            },
        )
        write_audit_log(
            db,
            module="Inventory",
            action="CORRECT",
            entity_type="BATCH",
            entity_id=corrected_batch.id,
            performed_by=current_user.id,
            summary=f"Stock reclassified in via {reference_id}",
            reason=payload.reason,
            remarks=payload.remarks,
            source_screen="Inventory / Stock Operations / Stock Correction",
            source_reference=reference_id,
            before_snapshot=None,
            after_snapshot=corrected_after,
            metadata={
                "direction": "IN",
                "qty": str(payload.qty_to_reclassify),
                "stock_correction_id": correction.id,
            },
        )
        _commit_with_tenant_context(db)
        db.refresh(correction)
    except AppException:
        db.rollback()
        raise
    except IntegrityError as error:
        db.rollback()
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Stock correction failed due to a data conflict. Please retry.",
            status_code=status.HTTP_400_BAD_REQUEST,
        ) from error

    return StockCorrectionResponse(
        id=correction.id,
        reference_id=reference_id,
        source_batch_id=payload.source_batch_id,
        corrected_batch_id=corrected_batch.id,
        qty_to_reclassify=payload.qty_to_reclassify,
        source_qty_on_hand=out_result.summary.qty_on_hand,
        corrected_qty_on_hand=in_result.summary.qty_on_hand,
        created_at=correction.created_at,
    )


@router.post("/out", response_model=InventoryActionResponse)
def create_stock_out(
    payload: InventoryOutRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("inventory:out")),
) -> InventoryActionResponse:
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
    return InventoryActionResponse(
        ledger_id=result.ledger.id,
        txn_type=result.ledger.txn_type,
        qty=result.ledger.qty,
        qty_on_hand=result.summary.qty_on_hand,
        created_at=result.ledger.created_at,
    )


@router.post("/adjust", response_model=InventoryActionResponse)
def create_stock_adjust_legacy(
    payload: InventoryAdjustRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("inventory:adjust")),
) -> InventoryActionResponse:
    result = stock_adjust(
        db,
        warehouse_id=payload.warehouse_id,
        product_id=payload.product_id,
        batch_id=payload.batch_id,
        delta_qty=payload.delta_qty,
        reason=payload.reason,
        created_by=current_user.id,
    )
    return InventoryActionResponse(
        ledger_id=result.ledger.id,
        txn_type=result.ledger.txn_type,
        qty=result.ledger.qty,
        qty_on_hand=result.summary.qty_on_hand,
        created_at=result.ledger.created_at,
    )


@router.get("/stock-adjustments", response_model=StockAdjustmentListResponse)
def list_stock_adjustments(
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("stock_adjustment:view")),
) -> StockAdjustmentListResponse:
    _ = current_user
    try:
        _ensure_stock_ops_schema_ready(db)
    except AppException as error:
        if error.error_code != "TENANT_SCHEMA_INCOMPATIBLE":
            raise
        return StockAdjustmentListResponse(total=0, page=page, page_size=page_size, data=[])
    creator = User.__table__.alias("creator")
    stmt = (
        select(
            StockAdjustment.id.label("id"),
            StockAdjustment.reference_id.label("reference_id"),
            Product.name.label("product_name"),
            Product.sku.label("sku"),
            Warehouse.name.label("warehouse_name"),
            Batch.batch_no.label("batch_no"),
            Batch.expiry_date.label("expiry_date"),
            StockAdjustment.adjustment_type.label("adjustment_type"),
            StockAdjustment.qty.label("qty"),
            StockAdjustment.reason.label("reason"),
            StockAdjustment.remarks.label("remarks"),
            StockAdjustment.before_qty.label("before_qty"),
            StockAdjustment.after_qty.label("after_qty"),
            creator.c.full_name.label("created_by_name"),
            StockAdjustment.created_at.label("created_at"),
        )
        .select_from(StockAdjustment)
        .join(Product, Product.id == StockAdjustment.product_id)
        .join(Warehouse, Warehouse.id == StockAdjustment.warehouse_id)
        .join(Batch, Batch.id == StockAdjustment.batch_id)
        .join(creator, creator.c.id == StockAdjustment.created_by)
    )
    if search:
        normalized = search.strip().lower()
        if normalized:
            pattern = f"%{normalized}%"
            stmt = stmt.where(
                or_(
                    func.lower(Product.name).like(pattern),
                    func.lower(Product.sku).like(pattern),
                    func.lower(Warehouse.name).like(pattern),
                    func.lower(Batch.batch_no).like(pattern),
                    func.lower(StockAdjustment.reference_id).like(pattern),
                )
            )
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.execute(count_stmt).scalar_one())
    rows = db.execute(
        stmt.order_by(StockAdjustment.created_at.desc(), StockAdjustment.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).mappings()
    return StockAdjustmentListResponse(
        total=total,
        page=page,
        page_size=page_size,
        data=[dict(row) for row in rows],
    )


@router.post("/stock-adjustments", response_model=StockAdjustmentResponse)
def create_stock_adjustment(
    payload: StockAdjustmentCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("stock_adjustment:apply")),
) -> StockAdjustmentResponse:
    _ensure_stock_ops_schema_ready(db)
    if payload.reason == StockAdjustmentReason.OTHER and not _normalized_reason_text(payload.remarks):
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Remarks are required when adjustment reason is OTHER.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    batch = db.get(Batch, payload.batch_id)
    if not batch:
        raise AppException(
            error_code="NOT_FOUND",
            message="Batch not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    if batch.product_id != payload.product_id:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Batch does not belong to the selected product",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    summary = (
        db.query(StockSummary)
        .filter(StockSummary.warehouse_id == payload.warehouse_id)
        .filter(StockSummary.product_id == payload.product_id)
        .filter(StockSummary.batch_id == payload.batch_id)
        .first()
    )
    before_qty = summary.qty_on_hand if summary is not None else Decimal("0")
    delta_qty = payload.qty if payload.adjustment_type == StockAdjustmentType.POSITIVE else -payload.qty

    try:
        adjustment = StockAdjustment(
            reference_id=f"ADJ-{uuid4().hex[:10].upper()}",
            warehouse_id=payload.warehouse_id,
            product_id=payload.product_id,
            batch_id=payload.batch_id,
            adjustment_type=payload.adjustment_type,
            qty=payload.qty,
            reason=payload.reason,
            remarks=payload.remarks,
            before_qty=before_qty,
            after_qty=before_qty + delta_qty,
            created_by=current_user.id,
        )
        db.add(adjustment)
        db.flush()

        result = stock_adjust(
            db,
            warehouse_id=payload.warehouse_id,
            product_id=payload.product_id,
            batch_id=payload.batch_id,
            delta_qty=delta_qty,
            reason=InventoryReason.STOCK_ADJUSTMENT,
            created_by=current_user.id,
            commit=False,
        )
        adjustment.ledger_id = result.ledger.id
        adjustment.after_qty = result.summary.qty_on_hand

        batch_snapshot = snapshot_model(
            batch,
            fields=["id", "batch_no", "expiry_date", "mfg_date", "mrp", "reference_id"],
        )
        adjustment_snapshot = snapshot_model(
            adjustment,
            fields=[
                "id",
                "reference_id",
                "warehouse_id",
                "product_id",
                "batch_id",
                "adjustment_type",
                "qty",
                "reason",
                "remarks",
                "before_qty",
                "after_qty",
                "ledger_id",
                "created_by",
                "created_at",
            ],
        )
        write_audit_log(
            db,
            module="Stock Adjustment",
            action="ADJUST",
            entity_type="STOCK_ADJUSTMENT",
            entity_id=adjustment.id,
            performed_by=current_user.id,
            summary=f"{payload.adjustment_type.value.title()} stock adjustment for batch {batch.batch_no}",
            reason=payload.reason.value,
            remarks=payload.remarks,
            source_screen="Inventory / Stock Operations / Stock Adjustment",
            source_reference=adjustment.reference_id,
            before_snapshot={**batch_snapshot, "qty_on_hand": str(before_qty)},
            after_snapshot={**adjustment_snapshot, "qty_on_hand": str(result.summary.qty_on_hand)},
            metadata={"ledger_id": result.ledger.id, "delta_qty": str(delta_qty)},
        )
        write_audit_log(
            db,
            module="Inventory",
            action="ADJUST",
            entity_type="BATCH",
            entity_id=batch.id,
            performed_by=current_user.id,
            summary=f"Stock adjusted via {adjustment.reference_id}",
            reason=payload.reason.value,
            remarks=payload.remarks,
            source_screen="Inventory / Stock Operations / Stock Adjustment",
            source_reference=adjustment.reference_id,
            before_snapshot={**batch_snapshot, "qty_on_hand": str(before_qty)},
            after_snapshot={**batch_snapshot, "qty_on_hand": str(result.summary.qty_on_hand)},
            metadata={"stock_adjustment_id": adjustment.id, "delta_qty": str(delta_qty)},
        )
        _commit_with_tenant_context(db)
        db.refresh(adjustment)
    except AppException:
        db.rollback()
        raise
    except IntegrityError as error:
        db.rollback()
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Stock adjustment failed due to a data conflict. Please retry.",
            status_code=status.HTTP_400_BAD_REQUEST,
        ) from error

    return StockAdjustmentResponse(
        id=adjustment.id,
        reference_id=adjustment.reference_id,
        ledger_id=result.ledger.id,
        txn_type=result.ledger.txn_type,
        qty=result.ledger.qty,
        before_qty=before_qty,
        after_qty=result.summary.qty_on_hand,
        created_at=adjustment.created_at,
    )
