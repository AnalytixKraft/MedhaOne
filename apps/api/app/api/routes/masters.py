import csv
import io
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from enum import Enum

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db, set_tenant_search_path
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.api.deps import get_current_user
from app.domain.quantity import quantity_precision_from_decimal_allowed
from app.domain.tax_identity import (
    derive_state_from_gstin,
    extract_pan_from_gstin,
    normalize_and_validate_gstin,
    normalize_optional_text,
)
from app.integrations.drug_license_verification.service import (
    DrugLicenseWorkflowState,
    resume_verification as resume_drug_license_verification,
    save_verified_data as save_drug_license_verified_data,
    start_verification as start_drug_license_verification,
)
from app.integrations.gst_verification.service import (
    GSTWorkflowState,
    resume_verification as resume_gst_verification,
    save_verified_data as save_gst_verified_data,
    start_verification as start_gst_verification,
)
from app.models.inventory import InventoryLedger, StockSummary
from app.models.brand import Brand
from app.models.category import Category
from app.models.drug_license import DrugLicenseVerificationLog
from app.models.gst_verification import GSTVerificationLog
from app.models.enums import (
    DrugLicenseVerificationLogStatus,
    GSTVerificationLogStatus,
    OutstandingTrackingMode,
    PartyCategory,
    PartyType,
    RegistrationType,
)
from app.models.party import Party
from app.models.product import Product
from app.models.purchase import GRN, PurchaseCreditNote, PurchaseOrder, PurchaseReturn
from app.models.purchase_bill import PurchaseBill
from app.models.sales import DispatchNote, SalesOrder, StockReservation
from app.models.stock_operations import StockAdjustment, StockCorrection
from app.models.tax_rate import TaxRate
from app.models.user import User
from app.models.warehouse import Rack, Warehouse
from app.schemas.masters import (
    BrandCreate,
    BrandRead,
    BrandUpdate,
    DrugLicenseVerificationHistoryResponse,
    DrugLicenseVerificationLogRead,
    DrugLicenseVerificationResumeRequest,
    DrugLicenseVerificationSaveRequest,
    DrugLicenseVerificationSessionResponse,
    DrugLicenseVerificationStartRequest,
    GSTVerificationHistoryResponse,
    GSTVerificationLogRead,
    GSTVerificationResumeRequest,
    GSTVerificationSaveRequest,
    GSTVerificationSessionResponse,
    GSTVerificationStartRequest,
    BulkImportError,
    BulkImportResult,
    CategoryCreate,
    CategoryRead,
    CategoryUpdate,
    PartyCreate,
    PartyRead,
    PartyUpdate,
    ProductCreate,
    ProductRead,
    ProductUpdate,
    RackCreate,
    RackRead,
    RackUpdate,
    WarehouseBulkDeleteError,
    WarehouseBulkDeleteRequest,
    WarehouseBulkDeleteResult,
    WarehouseCreate,
    WarehouseDeleteResult,
    WarehouseRead,
    WarehouseUpdate,
)
from app.services.audit import snapshot_model, write_audit_log

router = APIRouter()

LEGACY_PARTY_TYPE_MAP: dict[str, tuple[PartyType, PartyCategory | None]] = {
    "MANUFACTURER": (PartyType.SUPPLIER, PartyCategory.OTHER),
    "SUPER_STOCKIST": (PartyType.SUPPLIER, PartyCategory.STOCKIST),
    "DISTRIBUTOR": (PartyType.SUPPLIER, PartyCategory.DISTRIBUTOR),
    "HOSPITAL": (PartyType.CUSTOMER, PartyCategory.HOSPITAL),
    "PHARMACY": (PartyType.CUSTOMER, PartyCategory.PHARMACY),
    "RETAILER": (PartyType.CUSTOMER, PartyCategory.RETAILER),
    "CONSUMER": (PartyType.CUSTOMER, PartyCategory.OTHER),
}

CUSTOMER_PARTY_CATEGORIES = {
    PartyCategory.HOSPITAL.value,
    PartyCategory.PHARMACY.value,
    PartyCategory.RETAILER.value,
    PartyCategory.INSTITUTION.value,
}

SUPPLIER_PARTY_CATEGORIES = {
    PartyCategory.DISTRIBUTOR.value,
    PartyCategory.STOCKIST.value,
}

DEFAULT_PARTY_CATEGORY_NAMES = [
    PartyCategory.RETAILER.value,
    PartyCategory.DISTRIBUTOR.value,
    PartyCategory.STOCKIST.value,
    PartyCategory.HOSPITAL.value,
    PartyCategory.PHARMACY.value,
    PartyCategory.INSTITUTION.value,
    PartyCategory.OTHER.value,
]

PARTY_WRITE_FIELDS = {
    "name",
    "display_name",
    "party_type",
    "party_category",
    "contact_person",
    "designation",
    "phone",
    "whatsapp_no",
    "office_phone",
    "email",
    "website",
    "address",
    "address_line_2",
    "state",
    "city",
    "pincode",
    "country",
    "gstin",
    "pan_number",
    "registration_type",
    "drug_license_number",
    "drug_license_2_number",
    "fssai_number",
    "udyam_number",
    "credit_limit",
    "payment_terms",
    "opening_balance",
    "outstanding_tracking_mode",
    "is_active",
}


def _commit_with_tenant_context(db: Session) -> None:
    db.commit()
    tenant_schema = db.info.get("tenant_schema")
    if isinstance(tenant_schema, str) and tenant_schema:
        set_tenant_search_path(db, tenant_schema)


def _commit_or_400(db: Session, error_message: str, details: dict | None = None) -> None:
    try:
        _commit_with_tenant_context(db)
    except IntegrityError as error:
        db.rollback()
        raise AppException(
            error_code="VALIDATION_ERROR",
            message=error_message,
            status_code=status.HTTP_400_BAD_REQUEST,
            details=details,
        ) from error


def _get_or_404(db: Session, model, item_id: int, label: str):
    record = db.get(model, item_id)
    if not record:
        raise AppException(
            error_code="NOT_FOUND",
            message=f"{label} not found",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"id": item_id},
        )
    return record


def _warehouse_has_dependencies(db: Session, warehouse_id: int) -> bool:
    dependency_queries = (
        db.query(PurchaseOrder.id).filter(PurchaseOrder.warehouse_id == warehouse_id),
        db.query(GRN.id).filter(GRN.warehouse_id == warehouse_id),
        db.query(PurchaseBill.id).filter(PurchaseBill.warehouse_id == warehouse_id),
        db.query(PurchaseReturn.id).filter(PurchaseReturn.warehouse_id == warehouse_id),
        db.query(PurchaseCreditNote.id).filter(PurchaseCreditNote.warehouse_id == warehouse_id),
        db.query(InventoryLedger.id).filter(InventoryLedger.warehouse_id == warehouse_id),
        db.query(StockSummary.id).filter(StockSummary.warehouse_id == warehouse_id),
        db.query(StockCorrection.id).filter(StockCorrection.warehouse_id == warehouse_id),
        db.query(StockAdjustment.id).filter(StockAdjustment.warehouse_id == warehouse_id),
        db.query(SalesOrder.id).filter(SalesOrder.warehouse_id == warehouse_id),
        db.query(StockReservation.id).filter(StockReservation.warehouse_id == warehouse_id),
        db.query(DispatchNote.id).filter(DispatchNote.warehouse_id == warehouse_id),
    )
    return any(query.first() is not None for query in dependency_queries)


def _warehouse_has_stock_on_hand(db: Session, warehouse_id: int) -> bool:
    return (
        db.query(StockSummary.id)
        .filter(StockSummary.warehouse_id == warehouse_id)
        .filter(StockSummary.qty_on_hand > 0)
        .first()
        is not None
    )


def _product_has_stock_on_hand(db: Session, product_id: int) -> bool:
    return (
        db.query(StockSummary.id)
        .filter(StockSummary.product_id == product_id)
        .filter(StockSummary.qty_on_hand > 0)
        .first()
        is not None
    )


def _delete_or_deactivate_warehouse(
    db: Session,
    warehouse: Warehouse,
) -> WarehouseDeleteResult:
    if _warehouse_has_stock_on_hand(db, warehouse.id):
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Warehouse cannot be deleted while stock is available.",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "warehouse_id", "warehouse_id": warehouse.id},
        )

    if _warehouse_has_dependencies(db, warehouse.id):
        warehouse.is_active = False
        for rack in warehouse.racks:
            rack.is_active = False
        _commit_or_400(db, "Failed to deactivate warehouse")
        db.refresh(warehouse)
        return WarehouseDeleteResult(
            id=warehouse.id,
            action="deactivated",
            message="Warehouse has transactions and was deactivated instead of deleted.",
            warehouse=warehouse,
        )

    warehouse_snapshot = WarehouseRead.model_validate(warehouse)
    db.delete(warehouse)
    _commit_or_400(db, "Failed to delete warehouse")
    return WarehouseDeleteResult(
        id=warehouse_snapshot.id,
        action="deleted",
        message="Warehouse deleted successfully.",
        warehouse=warehouse_snapshot,
    )


def _normalize_party_payload(payload: dict) -> dict:
    normalized = dict(payload)
    raw_party_type = _to_text(normalized.get("party_type")).upper()
    raw_party_category = _to_text(normalized.get("party_category"))
    normalized_party_category = raw_party_category.upper()

    if raw_party_type in LEGACY_PARTY_TYPE_MAP:
        normalized_type, normalized_category = LEGACY_PARTY_TYPE_MAP[raw_party_type]
        normalized["party_type"] = normalized_type.value
        if not normalized_party_category and normalized_category is not None:
            normalized["party_category"] = normalized_category.value
    elif raw_party_type:
        normalized["party_type"] = PartyType(raw_party_type).value
    elif normalized_party_category in CUSTOMER_PARTY_CATEGORIES:
        normalized["party_type"] = PartyType.CUSTOMER.value
    elif normalized_party_category in SUPPLIER_PARTY_CATEGORIES:
        normalized["party_type"] = PartyType.SUPPLIER.value
    else:
        normalized["party_type"] = PartyType.BOTH.value

    normalized["party_category"] = _to_nullable_text(normalized.get("party_category"))

    normalized["name"] = _to_text(normalized.get("party_name") or normalized.get("name"))
    normalized["display_name"] = _to_nullable_text(normalized.get("display_name"))
    normalized["contact_person"] = _to_nullable_text(normalized.get("contact_person"))
    normalized["designation"] = _to_nullable_text(normalized.get("designation"))
    normalized["phone"] = _to_nullable_text(normalized.get("mobile") or normalized.get("phone"))
    normalized["whatsapp_no"] = _to_nullable_text(normalized.get("whatsapp_no"))
    normalized["office_phone"] = _to_nullable_text(normalized.get("office_phone"))
    normalized["state"] = _to_nullable_text(normalized.get("state"))
    normalized["city"] = _to_nullable_text(normalized.get("city"))
    normalized["pincode"] = _to_nullable_text(normalized.get("pincode"))
    normalized["email"] = _to_nullable_text(normalized.get("email"))
    normalized["website"] = _to_nullable_text(normalized.get("website"))
    normalized["address"] = _to_nullable_text(normalized.get("address_line_1") or normalized.get("address"))
    normalized["address_line_2"] = _to_nullable_text(normalized.get("address_line_2"))
    normalized["country"] = _to_nullable_text(normalized.get("country")) or "India"
    normalized["drug_license_number"] = _to_nullable_text(normalized.get("drug_license_number"))
    normalized["drug_license_2_number"] = _to_nullable_text(normalized.get("drug_license_2_number"))
    normalized["fssai_number"] = _to_nullable_text(normalized.get("fssai_number"))
    normalized["udyam_number"] = _to_nullable_text(normalized.get("udyam_number"))
    normalized["payment_terms"] = _to_nullable_text(normalized.get("payment_terms"))
    normalized["credit_limit"] = normalized.get("credit_limit") or Decimal("0.00")
    normalized["opening_balance"] = normalized.get("opening_balance") or Decimal("0.00")

    gstin = normalize_and_validate_gstin(normalized.get("gstin"))
    if not gstin:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="GSTIN is required for Party Master",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "gstin"},
        )

    normalized["gstin"] = gstin
    normalized["pan_number"] = extract_pan_from_gstin(gstin)
    if not normalized.get("state"):
        normalized["state"] = derive_state_from_gstin(gstin)
    if not normalized.get("registration_type"):
        normalized["registration_type"] = RegistrationType.REGISTERED.value

    outstanding_tracking_mode = _to_text(normalized.get("outstanding_tracking_mode")).upper()
    if outstanding_tracking_mode:
        normalized["outstanding_tracking_mode"] = OutstandingTrackingMode(
            outstanding_tracking_mode
        ).value
    elif normalized.get("outstanding_tracking_mode") is None:
        normalized["outstanding_tracking_mode"] = OutstandingTrackingMode.BILL_WISE.value

    return {field: normalized.get(field) for field in PARTY_WRITE_FIELDS}


def _ensure_unique_party_identifiers(
    db: Session,
    *,
    gstin: str | None,
    exclude_party_id: int | None = None,
) -> None:
    if gstin:
        query = db.query(Party.id).filter(func.upper(Party.gstin) == gstin.upper())
        if exclude_party_id is not None:
            query = query.filter(Party.id != exclude_party_id)
        if query.first() is not None:
            raise AppException(
                error_code="VALIDATION_ERROR",
                message="GSTIN already exists for another party",
                status_code=status.HTTP_400_BAD_REQUEST,
                details={"field": "gstin"},
            )

def _assign_party_code(party: Party) -> None:
    if party.id is None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Party code cannot be generated before the party is created",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    party.party_code = f"PTY-{party.id:06d}"


def _ensure_default_party_categories(db: Session) -> bool:
    existing_names = {
        str(name).strip().lower()
        for (name,) in db.query(Category.name).all()
        if isinstance(name, str) and name.strip()
    }
    candidate_names: list[str] = []
    seen_candidate_names: set[str] = set()
    for raw_name in [
        *DEFAULT_PARTY_CATEGORY_NAMES,
        *(
            str(name).strip()
            for (name,) in db.query(Party.party_category).distinct().all()
            if isinstance(name, str) and name.strip()
        ),
    ]:
        normalized_name = raw_name.strip().lower()
        if not normalized_name or normalized_name in seen_candidate_names:
            continue
        seen_candidate_names.add(normalized_name)
        candidate_names.append(raw_name.strip())

    missing_categories = [
        Category(name=name, is_active=True)
        for name in candidate_names
        if name.lower() not in existing_names
    ]
    if not missing_categories:
        return False
    db.add_all(missing_categories)
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Failed to prepare default party categories",
            status_code=status.HTTP_400_BAD_REQUEST,
        ) from error
    return True


def _count_active_parties_for_category(db: Session, category_name: str) -> int:
    return (
        db.query(func.count(Party.id))
        .filter(func.upper(Party.party_category) == category_name.strip().upper())
        .filter(Party.is_active.is_(True))
        .scalar()
        or 0
    )


def _validate_active_party_category_name(db: Session, category_name: str | None) -> str | None:
    normalized_category = _to_nullable_text(category_name)
    if not normalized_category:
        return None

    _ensure_default_party_categories(db)
    category_record = (
        db.query(Category)
        .filter(func.lower(Category.name) == normalized_category.lower())
        .filter(Category.is_active.is_(True))
        .first()
    )
    if category_record is None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Party Category must exist in Master Settings and be active",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "party_category"},
        )
    return category_record.name


def _ensure_master_brands_from_products(db: Session) -> bool:
    existing_names = {
        str(name).strip().lower()
        for (name,) in db.query(Brand.name).all()
        if isinstance(name, str) and name.strip()
    }
    existing_product_brands = {
        str(name).strip()
        for (name,) in db.query(Product.brand).distinct().all()
        if isinstance(name, str) and name.strip()
    }
    missing_brands = [
        Brand(name=name, is_active=True)
        for name in sorted(existing_product_brands)
        if name.lower() not in existing_names
    ]
    if not missing_brands:
        return False
    db.add_all(missing_brands)
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Failed to prepare existing manufacturers",
            status_code=status.HTTP_400_BAD_REQUEST,
        ) from error
    return True


def _require_masters_or_party_view(current_user=Depends(get_current_user)):
    if current_user.is_superuser:
        return current_user
    permissions = set(current_user.permissions)
    if "masters:view" in permissions or "party:view" in permissions:
        return current_user
    raise AppException(
        error_code="FORBIDDEN",
        message="Permission denied",
        status_code=403,
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


def _get_drug_license_log_or_404(db: Session, log_id: int) -> DrugLicenseVerificationLog:
    log = (
        db.query(DrugLicenseVerificationLog)
        .options(
            joinedload(DrugLicenseVerificationLog.party),
        )
        .filter(DrugLicenseVerificationLog.id == log_id)
        .first()
    )
    if log is None:
        raise AppException(
            error_code="NOT_FOUND",
            message="Drug licence verification session not found",
            status_code=404,
        )
    return log


def _serialize_drug_license_log(log: DrugLicenseVerificationLog) -> DrugLicenseVerificationLogRead:
    extracted_data = log.extracted_data_json if isinstance(log.extracted_data_json, dict) else {}
    requested_by_name = extracted_data.get("requested_by_name")
    return DrugLicenseVerificationLogRead(
        id=log.id,
        party_id=log.party_id,
        party_name=log.party.party_name if log.party is not None else None,
        drug_license_number=log.drug_license_number,
        requested_by=log.requested_by,
        requested_by_name=str(requested_by_name).strip() if requested_by_name else None,
        requested_at=log.requested_at,
        status=DrugLicenseVerificationLogStatus(log.status),
        source_url=log.source_url,
        extracted_data_json=log.extracted_data_json,
        response_snapshot=log.response_snapshot,
        remarks=log.remarks,
    )


def _get_gst_log_or_404(db: Session, log_id: int) -> GSTVerificationLog:
    log = (
        db.query(GSTVerificationLog)
        .options(joinedload(GSTVerificationLog.party))
        .filter(GSTVerificationLog.id == log_id)
        .first()
    )
    if log is None:
        raise AppException(
            error_code="NOT_FOUND",
            message="GST verification session not found",
            status_code=404,
        )
    return log


def _serialize_gst_log(log: GSTVerificationLog) -> GSTVerificationLogRead:
    extracted_data = log.extracted_data_json if isinstance(log.extracted_data_json, dict) else {}
    requested_by_name = extracted_data.get("requested_by_name")
    return GSTVerificationLogRead(
        id=log.id,
        party_id=log.party_id,
        party_name=log.party.party_name if log.party is not None else None,
        gstin=log.gstin,
        requested_by=log.requested_by,
        requested_by_name=str(requested_by_name).strip() if requested_by_name else None,
        requested_at=log.requested_at,
        status=GSTVerificationLogStatus(log.status),
        source_url=log.source_url,
        extracted_data_json=log.extracted_data_json,
        response_snapshot=log.response_snapshot,
        remarks=log.remarks,
    )


def _serialize_gst_workflow(
    workflow: GSTWorkflowState,
) -> GSTVerificationSessionResponse:
    result = workflow.result
    return GSTVerificationSessionResponse(
        log=_serialize_gst_log(workflow.log),
        verification_state=workflow.verification_state,
        challenge_text=workflow.challenge_text,
        result=(
            {
                "gstin": result.gstin,
                "legal_name": result.legal_name,
                "trade_name": result.trade_name,
                "status": result.status,
                "taxpayer_type": result.taxpayer_type,
                "registration_date": result.registration_date,
                "cancellation_date": result.cancellation_date,
                "constitution": result.constitution,
                "state_jurisdiction": result.state_jurisdiction,
                "central_jurisdiction": result.central_jurisdiction,
                "principal_address": result.principal_address,
                "nature_of_business": result.nature_of_business,
                "einvoice_status": result.einvoice_status,
                "raw_snapshot": result.raw_snapshot,
            }
            if result is not None
            else None
        ),
        can_resume=workflow.can_resume,
        can_save=workflow.can_save,
    )


def _serialize_drug_license_workflow(
    workflow: DrugLicenseWorkflowState,
) -> DrugLicenseVerificationSessionResponse:
    result = workflow.result
    return DrugLicenseVerificationSessionResponse(
        log=_serialize_drug_license_log(workflow.log),
        verification_state=workflow.verification_state,
        challenge_text=workflow.challenge_text,
        result=(
            {
                "license_number": result.license_number,
                "holder_name": result.holder_name,
                "status": result.status,
                "valid_upto": result.valid_upto,
                "authority": result.authority,
                "state": result.state,
                "raw_snapshot": result.raw_snapshot,
            }
            if result is not None
            else None
        ),
        can_resume=workflow.can_resume,
        can_save=workflow.can_save,
    )


def _parse_optional_iso_date(value: str | None, *, field_name: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message=f"Invalid {field_name}. Use YYYY-MM-DD.",
            status_code=400,
            details={"field": field_name},
        ) from error


def _to_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, Enum):
        return str(value.value).strip()
    return str(value).strip()


def _to_nullable_text(value: object) -> str | None:
    text = _to_text(value)
    return text or None


def _ensure_unique_category_name(
    db: Session,
    *,
    name: str,
    exclude_category_id: int | None = None,
) -> None:
    query = db.query(Category.id).filter(func.lower(Category.name) == name.strip().lower())
    if exclude_category_id is not None:
        query = query.filter(Category.id != exclude_category_id)
    if query.first() is not None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Category already exists",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "name"},
        )


def _ensure_unique_brand_name(
    db: Session,
    *,
    name: str,
    exclude_brand_id: int | None = None,
) -> None:
    query = db.query(Brand.id).filter(func.lower(Brand.name) == name.strip().lower())
    if exclude_brand_id is not None:
        query = query.filter(Brand.id != exclude_brand_id)
    if query.first() is not None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Manufacturer already exists",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "name"},
        )


def _validate_active_brand_name(db: Session, brand_name: str | None) -> str:
    normalized_brand = _to_text(brand_name)
    if not normalized_brand:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Manufacturer is required",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "brand"},
        )

    _ensure_master_brands_from_products(db)
    brand_record = (
        db.query(Brand)
        .filter(func.lower(Brand.name) == normalized_brand.lower())
        .filter(Brand.is_active.is_(True))
        .first()
    )
    if brand_record is None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Manufacturer must exist in Master Settings and be active",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "brand"},
        )
    return brand_record.name


def _validate_active_tax_rate(db: Session, gst_rate: Decimal | None) -> Decimal | None:
    if gst_rate is None:
        return None

    normalized_rate = Decimal(str(gst_rate)).quantize(Decimal("0.01"))
    rate_record = (
        db.query(TaxRate)
        .filter(TaxRate.rate_percent == normalized_rate)
        .filter(TaxRate.is_active.is_(True))
        .first()
    )
    if rate_record is None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="GST rate must exist in active tenant tax rates",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "gst_rate"},
        )
    return normalized_rate


def _validate_default_warehouse_id(db: Session, warehouse_id: int | None) -> int | None:
    if warehouse_id is None:
        return None

    warehouse = (
        db.query(Warehouse)
        .filter(Warehouse.id == warehouse_id)
        .filter(Warehouse.is_active.is_(True))
        .first()
    )
    if warehouse is None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Default warehouse must exist and be active",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "default_warehouse_id"},
        )
    return warehouse.id


def _validate_rack_number(
    db: Session,
    *,
    warehouse_id: int | None,
    rack_number: str | None,
) -> str | None:
    normalized_rack_number = _to_nullable_text(rack_number)
    if normalized_rack_number is None:
        return None

    if warehouse_id is None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Default warehouse is required when rack number is provided",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "rack_number"},
        )

    rack = (
        db.query(Rack)
        .filter(Rack.warehouse_id == warehouse_id)
        .filter(func.lower(Rack.rack_number) == normalized_rack_number.lower())
        .filter(Rack.is_active.is_(True))
        .first()
    )
    if rack is None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Rack number must exist in the selected warehouse and be active",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "rack_number"},
    )
    return rack.rack_number


def _normalize_rack_number_value(rack_number: str | None) -> str | None:
    return _to_nullable_text(rack_number)


def _validate_default_warehouse_for_import(
    db: Session,
    warehouse_id_text: str | None,
    warehouse_code_text: str | None,
) -> int | None:
    normalized_code = _to_text(warehouse_code_text)
    if normalized_code:
        warehouse = (
            db.query(Warehouse)
            .filter(func.lower(Warehouse.code) == normalized_code.lower())
            .filter(Warehouse.is_active.is_(True))
            .first()
        )
        if warehouse is None:
            raise AppException(
                error_code="VALIDATION_ERROR",
                message="Default warehouse code must exist and be active",
                status_code=status.HTTP_400_BAD_REQUEST,
                details={"field": "default_warehouse_code"},
            )
        return warehouse.id

    normalized_id = _to_text(warehouse_id_text)
    if not normalized_id:
        return None
    try:
        return _validate_default_warehouse_id(db, int(normalized_id))
    except ValueError as error:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Default warehouse ID must be numeric",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "default_warehouse_id"},
        ) from error


def _validate_rack_for_import(
    db: Session,
    *,
    warehouse_id: int | None,
    rack_number: str | None,
) -> str | None:
    return _validate_rack_number(db, warehouse_id=warehouse_id, rack_number=rack_number)


def _parse_import_bool(value: object, *, default: bool = False) -> bool:
    normalized = _to_text(value).lower()
    if not normalized:
        return default
    return normalized in {"true", "yes", "1", "y", "active"}


@router.get("/parties", response_model=list[PartyRead])
def list_parties(
    include_inactive: bool = Query(default=False),
    party_type: PartyType | None = Query(default=None),
    party_category: str | None = Query(default=None),
    state: str | None = Query(default=None),
    city: str | None = Query(default=None),
    gstin: str | None = Query(default=None),
    is_active: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("party:view")),
) -> list[PartyRead]:
    _ = current_user
    query = db.query(Party).order_by(Party.name.asc())
    if is_active is not None:
        query = query.filter(Party.is_active.is_(is_active))
    elif not include_inactive:
        query = query.filter(Party.is_active.is_(True))
    if party_type is not None:
        query = query.filter(Party.party_type == party_type.value)
    if party_category is not None:
        query = query.filter(func.lower(Party.party_category) == party_category.strip().lower())
    if state:
        query = query.filter(func.lower(Party.state) == state.strip().lower())
    if city:
        query = query.filter(func.lower(Party.city) == city.strip().lower())
    if gstin:
        query = query.filter(func.upper(Party.gstin) == gstin.strip().upper())
    if search:
        like_query = f"%{search.strip()}%"
        query = query.filter(
            Party.name.ilike(like_query)
            | Party.display_name.ilike(like_query)
            | Party.contact_person.ilike(like_query)
            | Party.gstin.ilike(like_query)
            | Party.city.ilike(like_query)
        )
    return query.all()


@router.get("/brands", response_model=list[BrandRead])
def list_brands(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:view")),
) -> list[BrandRead]:
    _ = current_user
    if _ensure_master_brands_from_products(db):
        _commit_or_400(db, "Failed to prepare existing brands")
    query = db.query(Brand).order_by(Brand.name.asc())
    if not include_inactive:
        query = query.filter(Brand.is_active.is_(True))
    return query.all()


@router.post("/brands", response_model=BrandRead, status_code=status.HTTP_201_CREATED)
def create_brand(
    payload: BrandCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> BrandRead:
    _ensure_unique_brand_name(db, name=payload.name)
    brand = Brand(**payload.model_dump())
    db.add(brand)
    _commit_or_400(db, "Failed to create brand")
    write_audit_log(
        db,
        module="Masters",
        entity_type="BRAND",
        entity_id=brand.id,
        action="CREATE",
        performed_by=current_user.id,
        summary=f"Created brand {brand.name}",
        source_screen="Masters / Master Settings / Brands",
        after_snapshot=snapshot_model(brand),
    )
    _commit_with_tenant_context(db)
    db.refresh(brand)
    return brand


@router.patch("/brands/{brand_id}", response_model=BrandRead)
def update_brand(
    brand_id: int,
    payload: BrandUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> BrandRead:
    brand = _get_or_404(db, Brand, brand_id, "Brand")
    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates:
        _ensure_unique_brand_name(db, name=str(updates["name"]), exclude_brand_id=brand.id)

    before_snapshot = snapshot_model(brand)
    for field, value in updates.items():
        setattr(brand, field, value)

    _commit_or_400(db, "Failed to update brand")
    write_audit_log(
        db,
        module="Masters",
        entity_type="BRAND",
        entity_id=brand.id,
        action="UPDATE",
        performed_by=current_user.id,
        summary=f"Updated brand {brand.name}",
        source_screen="Masters / Master Settings / Brands",
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(brand),
    )
    _commit_with_tenant_context(db)
    db.refresh(brand)
    return brand


@router.delete("/brands/{brand_id}", response_model=BrandRead)
def delete_brand(
    brand_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> BrandRead:
    brand = _get_or_404(db, Brand, brand_id, "Brand")
    before_snapshot = snapshot_model(brand)
    brand_snapshot = BrandRead.model_validate(brand)
    db.delete(brand)
    _commit_or_400(db, "Failed to delete brand")
    write_audit_log(
        db,
        module="Masters",
        entity_type="BRAND",
        entity_id=brand_snapshot.id,
        action="DELETE",
        performed_by=current_user.id,
        summary=f"Deleted brand {brand_snapshot.name}",
        source_screen="Masters / Master Settings / Brands",
        before_snapshot=before_snapshot,
    )
    _commit_with_tenant_context(db)
    return brand_snapshot


@router.get("/categories", response_model=list[CategoryRead])
def list_categories(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(_require_masters_or_party_view),
) -> list[CategoryRead]:
    _ = current_user
    if _ensure_default_party_categories(db):
        _commit_or_400(db, "Failed to prepare default party categories")
    query = db.query(Category).order_by(Category.name.asc())
    if not include_inactive:
        query = query.filter(Category.is_active.is_(True))
    return query.all()


@router.post("/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> CategoryRead:
    _ensure_default_party_categories(db)
    _ensure_unique_category_name(db, name=payload.name)
    category = Category(**payload.model_dump())
    db.add(category)
    _commit_or_400(db, "Failed to create category")
    write_audit_log(
        db,
        module="Masters",
        entity_type="CATEGORY",
        entity_id=category.id,
        action="CREATE",
        performed_by=current_user.id,
        summary=f"Created category {category.name}",
        source_screen="Masters / Master Settings / Categories",
        after_snapshot=snapshot_model(category),
    )
    _commit_with_tenant_context(db)
    db.refresh(category)
    return category


@router.patch("/categories/{category_id}", response_model=CategoryRead)
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> CategoryRead:
    _ensure_default_party_categories(db)
    category = _get_or_404(db, Category, category_id, "Category")
    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates:
        _ensure_unique_category_name(db, name=str(updates["name"]), exclude_category_id=category.id)
    if updates.get("is_active") is False:
        active_party_count = _count_active_parties_for_category(db, category.name)
        if active_party_count > 0:
            raise AppException(
                error_code="VALIDATION_ERROR",
                message="Party Category cannot be disabled while active parties are assigned to it.",
                status_code=status.HTTP_400_BAD_REQUEST,
                details={"field": "is_active", "active_party_count": active_party_count},
            )

    before_snapshot = snapshot_model(category)
    previous_name = category.name
    for field, value in updates.items():
        setattr(category, field, value)
    if "name" in updates and category.name != previous_name:
        (
            db.query(Party)
            .filter(func.upper(Party.party_category) == previous_name.upper())
            .update({"party_category": category.name}, synchronize_session=False)
        )

    _commit_or_400(db, "Failed to update category")
    write_audit_log(
        db,
        module="Masters",
        entity_type="CATEGORY",
        entity_id=category.id,
        action="UPDATE",
        performed_by=current_user.id,
        summary=f"Updated category {category.name}",
        source_screen="Masters / Master Settings / Categories",
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(category),
    )
    _commit_with_tenant_context(db)
    db.refresh(category)
    return category


@router.delete("/categories/{category_id}", response_model=CategoryRead)
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> CategoryRead:
    _ensure_default_party_categories(db)
    category = _get_or_404(db, Category, category_id, "Category")
    active_party_count = _count_active_parties_for_category(db, category.name)
    if active_party_count > 0:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Party Category cannot be deleted while active parties are assigned to it.",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "category_id", "active_party_count": active_party_count},
        )
    before_snapshot = snapshot_model(category)
    category_snapshot = CategoryRead.model_validate(category)
    db.delete(category)
    _commit_or_400(db, "Failed to delete category")
    write_audit_log(
        db,
        module="Masters",
        entity_type="CATEGORY",
        entity_id=category_snapshot.id,
        action="DELETE",
        performed_by=current_user.id,
        summary=f"Deleted category {category_snapshot.name}",
        source_screen="Masters / Master Settings / Categories",
        before_snapshot=before_snapshot,
    )
    _commit_with_tenant_context(db)
    return category_snapshot


@router.post("/parties", response_model=PartyRead, status_code=status.HTTP_201_CREATED)
def create_party(
    payload: PartyCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("party:create")),
) -> PartyRead:
    party_payload = _normalize_party_payload(payload.model_dump())
    party_payload["party_category"] = _validate_active_party_category_name(
        db, party_payload.get("party_category")
    )
    _ensure_unique_party_identifiers(
        db,
        gstin=party_payload.get("gstin"),
    )
    party = Party(**party_payload)
    db.add(party)
    db.flush()
    _assign_party_code(party)
    _commit_or_400(db, "Failed to create party")
    write_audit_log(
        db,
        module="PARTY_MASTER",
        entity_type="PARTY",
        entity_id=party.id,
        action="CREATE",
        performed_by=current_user.id,
        summary=f"Created party {party.party_name}",
        source_screen="Masters / Party Master",
        after_snapshot=snapshot_model(party),
    )
    _commit_with_tenant_context(db)
    db.refresh(party)
    return party


@router.get("/parties/template.csv")
def party_master_template(
    current_user=Depends(require_permission("party:view")),
) -> Response:
    _ = current_user
    csv_data = "\n".join(
        [
            "party_name,party_type,party_category,contact_person,mobile,email,address_line_1,city,state,pincode,gstin,drug_license_number,fssai_number,udyam_number,credit_limit,payment_terms",
            "ABC Traders,SUPPLIER,DISTRIBUTOR,Rajesh,9876543210,abc@example.com,Camp Pune,Pune,Maharashtra,411045,27ABCDE1234F1Z5,DL-001,FSSAI-001,UDYAM-001,150000,30 days",
        ]
    )
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="party-master-template.csv"'},
    )


@router.get("/parties/{party_id}", response_model=PartyRead)
def get_party(
    party_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("party:view")),
) -> PartyRead:
    _ = current_user
    return _get_or_404(db, Party, party_id, "Party")


@router.patch("/parties/{party_id}", response_model=PartyRead)
def update_party(
    party_id: int,
    payload: PartyUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("party:update")),
) -> PartyRead:
    party = _get_or_404(db, Party, party_id, "Party")
    before_snapshot = snapshot_model(party)
    existing_payload = {
        "party_name": party.party_name,
        "display_name": party.display_name,
        "party_type": party.party_type,
        "party_category": party.party_category,
        "contact_person": party.contact_person,
        "designation": party.designation,
        "mobile": party.mobile,
        "whatsapp_no": party.whatsapp_no,
        "office_phone": party.office_phone,
        "email": party.email,
        "website": party.website,
        "address_line_1": party.address_line_1,
        "address_line_2": party.address_line_2,
        "state": party.state,
        "city": party.city,
        "pincode": party.pincode,
        "country": party.country,
        "gstin": party.gstin,
        "pan_number": party.pan_number,
        "registration_type": party.registration_type,
        "drug_license_number": party.drug_license_number,
        "drug_license_2_number": party.drug_license_2_number,
        "fssai_number": party.fssai_number,
        "udyam_number": party.udyam_number,
        "credit_limit": party.credit_limit,
        "payment_terms": party.payment_terms,
        "opening_balance": party.opening_balance,
        "outstanding_tracking_mode": party.outstanding_tracking_mode,
        "is_active": party.is_active,
    }
    merged_payload = {**existing_payload, **payload.model_dump(exclude_unset=True)}
    updates = _normalize_party_payload(merged_payload)
    updates["party_category"] = _validate_active_party_category_name(db, updates.get("party_category"))
    _ensure_unique_party_identifiers(
        db,
        gstin=updates.get("gstin"),
        exclude_party_id=party.id,
    )

    for field, value in updates.items():
        setattr(party, field, value)
    if not party.party_code:
        _assign_party_code(party)

    _commit_or_400(db, "Failed to update party")
    write_audit_log(
        db,
        module="PARTY_MASTER",
        entity_type="PARTY",
        entity_id=party.id,
        action="UPDATE",
        performed_by=current_user.id,
        summary=f"Updated party {party.party_name}",
        source_screen="Masters / Party Master",
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(party),
    )
    _commit_with_tenant_context(db)
    db.refresh(party)
    return party


@router.put("/parties/{party_id}", response_model=PartyRead)
def replace_party(
    party_id: int,
    payload: PartyUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("party:update")),
) -> PartyRead:
    return update_party(party_id=party_id, payload=payload, db=db, current_user=current_user)


@router.post("/parties/bulk", response_model=BulkImportResult)
async def bulk_create_parties(
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("party:bulk_create")),
) -> BulkImportResult:
    rows = await _read_bulk_rows(request)
    errors: list[BulkImportError] = []
    created_count = 0
    created_party_ids: list[int] = []

    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            errors.append(_bulk_error(index, "Row must be an object"))
            continue

        row_payload = {
            "party_name": _to_text(row.get("party_name") or row.get("name")),
            "display_name": _to_text(row.get("display_name")) or None,
            "party_type": _to_text(row.get("party_type") or row.get("type")) or "CUSTOMER",
            "party_category": _to_text(row.get("party_category") or row.get("category")) or None,
            "contact_person": _to_text(row.get("contact_person")) or None,
            "designation": _to_text(row.get("designation")) or None,
            "mobile": _to_text(row.get("mobile") or row.get("phone")) or None,
            "whatsapp_no": _to_text(row.get("whatsapp_no")) or None,
            "office_phone": _to_text(row.get("office_phone")) or None,
            "email": _to_text(row.get("email")) or None,
            "website": _to_text(row.get("website")) or None,
            "address_line_1": _to_text(row.get("address_line_1") or row.get("address")) or None,
            "address_line_2": _to_text(row.get("address_line_2")) or None,
            "state": _to_text(row.get("state")) or None,
            "city": _to_text(row.get("city")) or None,
            "pincode": _to_text(row.get("pincode")) or None,
            "country": _to_text(row.get("country")) or "India",
            "gstin": _to_text(row.get("gstin")) or None,
            "pan_number": _to_text(row.get("pan_number")) or None,
            "registration_type": _to_text(row.get("registration_type")) or None,
            "drug_license_number": _to_text(row.get("drug_license_number")) or None,
            "fssai_number": _to_text(row.get("fssai_number")) or None,
            "udyam_number": _to_text(row.get("udyam_number")) or None,
            "credit_limit": _to_text(row.get("credit_limit")) or Decimal("0.00"),
            "payment_terms": _to_text(row.get("payment_terms")) or None,
            "opening_balance": _to_text(row.get("opening_balance")) or Decimal("0.00"),
            "outstanding_tracking_mode": _to_text(row.get("outstanding_tracking_mode")) or None,
            "is_active": True,
        }

        try:
            with db.begin_nested():
                party_input = PartyCreate(**row_payload)
                party_model_payload = _normalize_party_payload(party_input.model_dump())
                party_model_payload["party_category"] = _validate_active_party_category_name(
                    db, party_model_payload.get("party_category")
                )
                _ensure_unique_party_identifiers(
                    db,
                    gstin=party_model_payload.get("gstin"),
                )
                party = Party(**party_model_payload)
                db.add(party)
                db.flush()
                _assign_party_code(party)
                created_party_ids.append(party.id)
            created_count += 1
        except AppException as error:
            errors.append(
                _bulk_error(index, error.message, (error.details or {}).get("field"))
            )
        except Exception as error:  # pydantic validation or db validation
            errors.append(_bulk_error(index, str(error)))

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Failed to commit bulk party import",
        ) from error

    if created_party_ids:
        write_audit_log(
            db,
            module="PARTY_MASTER",
            entity_type="PARTY",
            entity_id=created_party_ids[0],
            action="BULK_CREATE",
            performed_by=current_user.id,
            summary=f"Bulk created {created_count} parties",
            source_screen="Masters / Party Master",
            metadata={
                "created_party_ids": created_party_ids,
                "created_count": created_count,
                "failed_count": len(errors),
            },
        )
        _commit_with_tenant_context(db)

    return BulkImportResult(
        created_count=created_count,
        failed_count=len(errors),
        errors=errors,
    )


@router.delete("/parties/{party_id}", response_model=PartyRead)
def delete_party(
    party_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("party:deactivate")),
) -> PartyRead:
    party = _get_or_404(db, Party, party_id, "Party")
    before_snapshot = snapshot_model(party)
    party.is_active = False
    _commit_or_400(db, "Failed to deactivate party")
    write_audit_log(
        db,
        module="PARTY_MASTER",
        entity_type="PARTY",
        entity_id=party.id,
        action="DEACTIVATE",
        performed_by=current_user.id,
        summary=f"Deactivated party {party.party_name}",
        source_screen="Masters / Party Master",
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(party),
    )
    _commit_with_tenant_context(db)
    db.refresh(party)
    return party


@router.post(
    "/drug-license-verification/start",
    response_model=DrugLicenseVerificationSessionResponse,
)
def start_drug_license_verification_session(
    payload: DrugLicenseVerificationStartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("drug_license:verify")),
) -> DrugLicenseVerificationSessionResponse:
    party: Party | None = None
    if payload.party_id is not None:
        party = _get_or_404(db, Party, payload.party_id, "Party")
    drug_license_number = _to_nullable_text(payload.drug_license_number) or (party.drug_license_number if party else None)
    if not drug_license_number:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Drug licence number is required to start verification.",
            status_code=400,
            details={"field": "drug_license_number"},
        )

    workflow = start_drug_license_verification(
        db,
        party=party,
        drug_license_number=drug_license_number,
        requested_by=current_user.id,
    )
    if isinstance(workflow.log.extracted_data_json, dict):
        workflow.log.extracted_data_json["requested_by_name"] = current_user.full_name
    _commit_with_tenant_context(db)
    workflow.log = _get_drug_license_log_or_404(db, workflow.log.id)
    return _serialize_drug_license_workflow(workflow)


@router.post(
    "/drug-license-verification/{log_id}/resume",
    response_model=DrugLicenseVerificationSessionResponse,
)
def resume_drug_license_verification_session(
    log_id: int,
    payload: DrugLicenseVerificationResumeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("drug_license:verify")),
) -> DrugLicenseVerificationSessionResponse:
    _ = current_user
    log = _get_drug_license_log_or_404(db, log_id)
    workflow = resume_drug_license_verification(log=log, captcha_value=payload.captcha_value)
    _commit_with_tenant_context(db)
    workflow.log = _get_drug_license_log_or_404(db, workflow.log.id)
    return _serialize_drug_license_workflow(workflow)


@router.post(
    "/drug-license-verification/{log_id}/save",
    response_model=PartyRead,
)
def save_drug_license_verification_session(
    log_id: int,
    payload: DrugLicenseVerificationSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("drug_license:save_verified_data")),
) -> PartyRead:
    log = _get_drug_license_log_or_404(db, log_id)
    party = _get_or_404(db, Party, log.party_id, "Party")
    before_snapshot = snapshot_model(party)
    parsed = save_drug_license_verified_data(
        log=log,
        party=party,
        saved_by=current_user.id,
        remarks=payload.remarks,
        slot=payload.slot,
    )
    _commit_or_400(db, "Failed to save verified drug licence data")
    write_audit_log(
        db,
        module="PARTY_MASTER",
        entity_type="PARTY",
        entity_id=party.id,
        action="VERIFY_DRUG_LICENSE",
        performed_by=current_user.id,
        summary=f"Saved verified drug licence data for {party.party_name}",
        source_screen="Masters / Drug Licence Verification",
        source_reference=str(log.id),
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(party),
        metadata={
            "verification_log_id": log.id,
            "license_number": parsed.license_number,
            "slot": payload.slot,
            "verification_status": (
                party.drug_license_verified_status
                if payload.slot == 1
                else party.drug_license_2_verified_status
            ),
        },
    )
    _commit_with_tenant_context(db)
    db.refresh(party)
    return party


@router.get(
    "/drug-license-verification/history",
    response_model=DrugLicenseVerificationHistoryResponse,
)
def list_drug_license_verification_history(
    party_id: int | None = Query(default=None),
    status_filter: DrugLicenseVerificationLogStatus | None = Query(default=None, alias="status"),
    verified_by: int | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("drug_license:history_view")),
) -> DrugLicenseVerificationHistoryResponse:
    _ = current_user
    query = (
        db.query(DrugLicenseVerificationLog)
        .options(
            joinedload(DrugLicenseVerificationLog.party),
        )
        .order_by(DrugLicenseVerificationLog.requested_at.desc(), DrugLicenseVerificationLog.id.desc())
    )
    if party_id is not None:
        query = query.filter(DrugLicenseVerificationLog.party_id == party_id)
    if status_filter is not None:
        query = query.filter(DrugLicenseVerificationLog.status == status_filter.value)
    if verified_by is not None:
        query = query.filter(DrugLicenseVerificationLog.requested_by == verified_by)
    parsed_date_from = _parse_optional_iso_date(date_from, field_name="date_from")
    parsed_date_to = _parse_optional_iso_date(date_to, field_name="date_to")
    if parsed_date_from:
        query = query.filter(DrugLicenseVerificationLog.requested_at >= parsed_date_from)
    if parsed_date_to:
        query = query.filter(
            DrugLicenseVerificationLog.requested_at < (parsed_date_to + timedelta(days=1))
        )
    return DrugLicenseVerificationHistoryResponse(
        items=[_serialize_drug_license_log(log) for log in query.all()]
    )


@router.get(
    "/drug-license-verification/history/{log_id}",
    response_model=DrugLicenseVerificationLogRead,
)
def get_drug_license_verification_history_detail(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("drug_license:history_view")),
) -> DrugLicenseVerificationLogRead:
    _ = current_user
    return _serialize_drug_license_log(_get_drug_license_log_or_404(db, log_id))


# ---------------------------------------------------------------------------
# GST Verification endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/gst-verification/start",
    response_model=GSTVerificationSessionResponse,
)
def start_gst_verification_session(
    payload: GSTVerificationStartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("gst:verify")),
) -> GSTVerificationSessionResponse:
    party: Party | None = None
    if payload.party_id is not None:
        party = _get_or_404(db, Party, payload.party_id, "Party")
    gstin = _to_nullable_text(payload.gstin) or (party.gstin if party else None)
    if not gstin:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="GSTIN is required to start verification.",
            status_code=400,
            details={"field": "gstin"},
        )

    workflow = start_gst_verification(
        db,
        party=party,
        gstin=gstin,
        requested_by=current_user.id,
    )
    if isinstance(workflow.log.extracted_data_json, dict):
        workflow.log.extracted_data_json["requested_by_name"] = current_user.full_name
    _commit_with_tenant_context(db)
    workflow.log = _get_gst_log_or_404(db, workflow.log.id)
    return _serialize_gst_workflow(workflow)


@router.post(
    "/gst-verification/{log_id}/resume",
    response_model=GSTVerificationSessionResponse,
)
def resume_gst_verification_session(
    log_id: int,
    payload: GSTVerificationResumeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("gst:verify")),
) -> GSTVerificationSessionResponse:
    _ = current_user
    log = _get_gst_log_or_404(db, log_id)
    workflow = resume_gst_verification(log=log, captcha_value=payload.captcha_value)
    _commit_with_tenant_context(db)
    workflow.log = _get_gst_log_or_404(db, workflow.log.id)
    return _serialize_gst_workflow(workflow)


@router.post(
    "/gst-verification/{log_id}/save",
    response_model=PartyRead,
)
def save_gst_verification_session(
    log_id: int,
    payload: GSTVerificationSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("gst:save_verified_data")),
) -> PartyRead:
    log = _get_gst_log_or_404(db, log_id)
    party = _get_or_404(db, Party, log.party_id, "Party")
    before_snapshot = snapshot_model(party)
    parsed = save_gst_verified_data(
        log=log,
        party=party,
        saved_by=current_user.id,
        remarks=payload.remarks,
    )
    _commit_or_400(db, "Failed to save verified GST data")
    write_audit_log(
        db,
        module="PARTY_MASTER",
        entity_type="PARTY",
        entity_id=party.id,
        action="VERIFY_GST",
        performed_by=current_user.id,
        summary=f"Saved verified GST data for {party.party_name}",
        source_screen="Masters / GST Verification",
        source_reference=str(log.id),
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(party),
        metadata={
            "verification_log_id": log.id,
            "gstin": parsed.gstin,
            "gst_status": party.gst_verified_status,
        },
    )
    _commit_with_tenant_context(db)
    db.refresh(party)
    return party


@router.get(
    "/gst-verification/history",
    response_model=GSTVerificationHistoryResponse,
)
def list_gst_verification_history(
    party_id: int | None = Query(default=None),
    status_filter: GSTVerificationLogStatus | None = Query(default=None, alias="status"),
    verified_by: int | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("gst:history_view")),
) -> GSTVerificationHistoryResponse:
    _ = current_user
    query = (
        db.query(GSTVerificationLog)
        .options(joinedload(GSTVerificationLog.party))
        .order_by(GSTVerificationLog.requested_at.desc(), GSTVerificationLog.id.desc())
    )
    if party_id is not None:
        query = query.filter(GSTVerificationLog.party_id == party_id)
    if status_filter is not None:
        query = query.filter(GSTVerificationLog.status == status_filter.value)
    if verified_by is not None:
        query = query.filter(GSTVerificationLog.requested_by == verified_by)
    parsed_date_from = _parse_optional_iso_date(date_from, field_name="date_from")
    parsed_date_to = _parse_optional_iso_date(date_to, field_name="date_to")
    if parsed_date_from:
        query = query.filter(GSTVerificationLog.requested_at >= parsed_date_from)
    if parsed_date_to:
        query = query.filter(
            GSTVerificationLog.requested_at < (parsed_date_to + timedelta(days=1))
        )
    return GSTVerificationHistoryResponse(
        items=[_serialize_gst_log(log) for log in query.all()]
    )


@router.get(
    "/gst-verification/history/{log_id}",
    response_model=GSTVerificationLogRead,
)
def get_gst_verification_history_detail(
    log_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("gst:history_view")),
) -> GSTVerificationLogRead:
    _ = current_user
    return _serialize_gst_log(_get_gst_log_or_404(db, log_id))


@router.get("/products", response_model=list[ProductRead])
def list_products(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:view")),
) -> list[ProductRead]:
    _ = current_user
    query = db.query(Product).options(joinedload(Product.default_warehouse)).order_by(Product.name.asc())
    if not include_inactive:
        query = query.filter(Product.is_active.is_(True))
    return query.all()


@router.post("/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> ProductRead:
    payload_data = payload.model_dump()
    payload_data["brand"] = _validate_active_brand_name(db, payload_data.get("brand"))
    payload_data["gst_rate"] = _validate_active_tax_rate(db, payload_data.get("gst_rate"))
    payload_data["default_warehouse_id"] = _validate_default_warehouse_id(
        db, payload_data.get("default_warehouse_id")
    )
    payload_data["rack_number"] = _validate_rack_number(
        db,
        warehouse_id=payload_data.get("default_warehouse_id"),
        rack_number=payload_data.get("rack_number"),
    )
    payload_data["quantity_precision"] = quantity_precision_from_decimal_allowed(
        bool(payload_data.get("decimal_allowed"))
    )
    product = Product(**payload_data)
    db.add(product)
    _commit_or_400(
        db,
        "Failed to create product. SKU must be unique",
        details={"field": "sku"},
    )
    write_audit_log(
        db,
        module="Inventory",
        entity_type="PRODUCT",
        entity_id=product.id,
        action="CREATE",
        performed_by=current_user.id,
        summary=f"Created product {product.sku}",
        source_screen="Masters / Products",
        after_snapshot=snapshot_model(product),
    )
    _commit_with_tenant_context(db)
    db.refresh(product)
    return product


@router.post("/items/bulk", response_model=BulkImportResult)
async def bulk_create_items(
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> BulkImportResult:
    _ = current_user
    rows = await _read_bulk_rows(request)
    errors: list[BulkImportError] = []
    created_count = 0

    valid_tax_rates = {
        Decimal(str(rate_percent)).quantize(Decimal("0.01"))
        for (rate_percent,) in db.query(TaxRate.rate_percent)
        .filter(TaxRate.is_active.is_(True))
        .all()
    }
    existing_skus = {sku for (sku,) in db.query(Product.sku).all()}
    seen_skus: set[str] = set()

    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            errors.append(_bulk_error(index, "Row must be an object"))
            continue

        sku = _to_text(row.get("sku"))
        if not sku:
            errors.append(_bulk_error(index, "SKU is required", "sku"))
            continue
        if sku in seen_skus or sku in existing_skus:
            errors.append(_bulk_error(index, "SKU must be unique", "sku"))
            continue

        try:
            brand_name = _validate_active_brand_name(
                db,
                _to_text(row.get("manufacturer") or row.get("brand")),
            )
        except AppException as error:
            errors.append(_bulk_error(index, error.message, (error.details or {}).get("field")))
            continue

        gst_rate_value: Decimal | None = None
        gst_rate_raw = _to_text(row.get("gst_rate"))
        if gst_rate_raw:
            try:
                gst_rate_value = Decimal(gst_rate_raw).quantize(Decimal("0.01"))
            except InvalidOperation:
                errors.append(_bulk_error(index, "Invalid GST rate", "gst_rate"))
                continue

            if gst_rate_value not in valid_tax_rates:
                errors.append(
                    _bulk_error(index, "GST rate does not exist in active tenant tax rates", "gst_rate")
                )
                continue

        try:
            default_warehouse_id_text = _to_text(row.get("default_warehouse_id"))
            default_warehouse_code_text = _to_text(
                row.get("default_warehouse_code") or row.get("warehouse_code")
            )
            with db.begin_nested():
                default_warehouse_id = _validate_default_warehouse_for_import(
                    db,
                    default_warehouse_id_text,
                    default_warehouse_code_text,
                )
                product_input = ProductCreate(
                    sku=sku,
                    name=_to_text(row.get("product_name") or row.get("name")),
                    display_name=_to_text(row.get("display_name")) or None,
                    brand=brand_name,
                    category=_to_text(row.get("category")) or None,
                    uom=_to_text(row.get("uom")),
                    decimal_allowed=_parse_import_bool(row.get("decimal_allowed"), default=False),
                    barcode=_to_text(row.get("barcode")) or None,
                    hsn=_to_text(row.get("hsn")) or None,
                    gst_rate=gst_rate_value,
                    default_warehouse_id=default_warehouse_id,
                    rack_number=_validate_rack_for_import(
                        db,
                        warehouse_id=default_warehouse_id,
                        rack_number=_to_text(row.get("rack_number")) or None,
                    ),
                    default_purchase_rate=Decimal(_to_text(row.get("default_purchase_rate")))
                    if _to_text(row.get("default_purchase_rate"))
                    else None,
                    default_sale_rate=Decimal(_to_text(row.get("default_sale_rate")))
                    if _to_text(row.get("default_sale_rate"))
                    else None,
                    mrp=Decimal(_to_text(row.get("mrp"))) if _to_text(row.get("mrp")) else None,
                    is_active=_parse_import_bool(row.get("is_active"), default=True),
                )
                product = Product(**product_input.model_dump())
                db.add(product)
                db.flush()
            seen_skus.add(sku)
            created_count += 1
        except Exception as error:
            errors.append(_bulk_error(index, str(error)))

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Failed to commit bulk item import",
        ) from error

    return BulkImportResult(
        created_count=created_count,
        failed_count=len(errors),
        errors=errors,
    )


@router.get("/products/{product_id}", response_model=ProductRead)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:view")),
) -> ProductRead:
    _ = current_user
    product = (
        db.query(Product)
        .options(joinedload(Product.default_warehouse))
        .filter(Product.id == product_id)
        .first()
    )
    if product is None:
        raise AppException(error_code="NOT_FOUND", message="Product not found", status_code=404)
    return product


@router.put("/products/{product_id}", response_model=ProductRead)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> ProductRead:
    product = _get_or_404(db, Product, product_id, "Product")
    before_snapshot = snapshot_model(product)
    changed_fields = payload.model_dump(exclude_unset=True)
    if "brand" in changed_fields or not product.brand:
        changed_fields["brand"] = _validate_active_brand_name(
            db,
            changed_fields.get("brand", product.brand),
        )
    if "gst_rate" in changed_fields:
        changed_fields["gst_rate"] = _validate_active_tax_rate(db, changed_fields.get("gst_rate"))
    if "default_warehouse_id" in changed_fields:
        changed_fields["default_warehouse_id"] = _validate_default_warehouse_id(
            db, changed_fields.get("default_warehouse_id")
        )
    if "rack_number" in changed_fields or "default_warehouse_id" in changed_fields:
        changed_fields["rack_number"] = _validate_rack_number(
            db,
            warehouse_id=changed_fields.get("default_warehouse_id", product.default_warehouse_id),
            rack_number=changed_fields.get("rack_number", product.rack_number),
        )
    if "decimal_allowed" in changed_fields:
        changed_fields["quantity_precision"] = quantity_precision_from_decimal_allowed(
            bool(changed_fields["decimal_allowed"])
        )
    for field, value in changed_fields.items():
        setattr(product, field, value)

    _commit_or_400(db, "Failed to update product")
    write_audit_log(
        db,
        module="Inventory",
        entity_type="PRODUCT",
        entity_id=product.id,
        action="UPDATE",
        performed_by=current_user.id,
        summary=f"Updated product {product.sku}",
        source_screen="Masters / Products",
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(product),
    )
    _commit_with_tenant_context(db)
    db.refresh(product)
    return product


@router.delete("/products/{product_id}", response_model=ProductRead)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> ProductRead:
    product = _get_or_404(db, Product, product_id, "Product")
    if _product_has_stock_on_hand(db, product.id):
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Product cannot be deleted while stock is available.",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "product_id", "product_id": product.id},
        )
    before_snapshot = snapshot_model(product)
    product.is_active = False
    _commit_or_400(db, "Failed to deactivate product")
    write_audit_log(
        db,
        module="Inventory",
        entity_type="PRODUCT",
        entity_id=product.id,
        action="DEACTIVATE",
        performed_by=current_user.id,
        summary=f"Deactivated product {product.sku}",
        source_screen="Masters / Products",
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(product),
    )
    _commit_with_tenant_context(db)
    db.refresh(product)
    return product


@router.get("/templates/party-import.csv")
def party_import_template(
    current_user=Depends(require_permission("party:view")),
) -> Response:
    _ = current_user
    csv_data = "\n".join(
        [
            "party_name,party_type,party_category,contact_person,mobile,email,address_line_1,city,state,pincode,gstin,drug_license_number,fssai_number,udyam_number,credit_limit,payment_terms",
            "ABC Traders,SUPPLIER,DISTRIBUTOR,Rajesh,9876543210,abc@example.com,Camp Pune,Pune,Maharashtra,411045,27ABCDE1234F1Z5,DL-001,FSSAI-001,UDYAM-001,150000,30 days",
            "City Care Pharmacy,BOTH,PHARMACY,Anita,9999999999,citycare@example.com,MG Road,Bengaluru,Karnataka,560001,29AAAPL1234C1Z3,DL-002,FSSAI-002,UDYAM-002,50000,15 days",
        ]
    )
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="party-master-template.csv"'},
    )


@router.get("/templates/item-import.csv")
def item_import_template(
    current_user=Depends(require_permission("masters:view")),
) -> Response:
    _ = current_user
    csv_data = "\n".join(
        [
            "sku,product_name,display_name,manufacturer,category,uom,gst_rate,hsn,default_warehouse_code,rack_number,decimal_allowed,default_purchase_rate,default_sale_rate,mrp,is_active",
            "SKU001,Paracetamol 500,Paracetamol 500,Medha Pharma,General Medicines,PCS,5.00,3004,MAINWH,RACK-A1,no,12.50,15.00,18.00,yes",
            "SKU002,Crocin Tablet,Crocin Tab,Medha Pharma,Fever & Pain,BOX,12.00,3004,COLDWH,RACK-B3,no,45.00,52.00,60.00,yes",
        ]
    )
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="item-import.csv"'},
    )


@router.get("/warehouses", response_model=list[WarehouseRead])
def list_warehouses(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:view")),
) -> list[WarehouseRead]:
    _ = current_user
    query = db.query(Warehouse).order_by(Warehouse.name.asc())
    if not include_inactive:
        query = query.filter(Warehouse.is_active.is_(True))
    return query.all()


@router.get("/racks", response_model=list[RackRead])
def list_racks(
    warehouse_id: int | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:view")),
) -> list[RackRead]:
    _ = current_user
    query = (
        db.query(Rack)
        .options(joinedload(Rack.warehouse))
        .join(Warehouse, Rack.warehouse_id == Warehouse.id)
        .order_by(Warehouse.name.asc(), Rack.rack_number.asc())
    )
    if warehouse_id is not None:
        query = query.filter(Rack.warehouse_id == warehouse_id)
    if not include_inactive:
        query = query.filter(Rack.is_active.is_(True)).filter(Warehouse.is_active.is_(True))
    return query.all()


@router.post("/racks", response_model=RackRead, status_code=status.HTTP_201_CREATED)
def create_rack(
    payload: RackCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> RackRead:
    warehouse_id = _validate_default_warehouse_id(db, payload.warehouse_id)
    rack = Rack(
        warehouse_id=warehouse_id,
        rack_number=_normalize_rack_number_value(payload.rack_number),
        description=payload.description,
        is_active=payload.is_active,
    )
    db.add(rack)
    _commit_or_400(
        db,
        "Failed to create rack. Rack number must be unique inside the warehouse",
        details={"field": "rack_number"},
    )
    write_audit_log(
        db,
        module="Masters",
        entity_type="RACK",
        entity_id=rack.id,
        action="CREATE",
        performed_by=current_user.id,
        summary=f"Created rack {rack.rack_number}",
        source_screen="Masters / Rack Numbers",
        after_snapshot=snapshot_model(rack),
    )
    _commit_with_tenant_context(db)
    rack = (
        db.query(Rack)
        .options(joinedload(Rack.warehouse))
        .filter(Rack.id == rack.id)
        .first()
    )
    return rack


@router.post("/warehouses", response_model=WarehouseRead, status_code=status.HTTP_201_CREATED)
def create_warehouse(
    payload: WarehouseCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> WarehouseRead:
    _ = current_user
    warehouse = Warehouse(**payload.model_dump())
    db.add(warehouse)
    _commit_or_400(
        db,
        "Failed to create warehouse. Code must be unique",
        details={"field": "code"},
    )
    db.refresh(warehouse)
    return warehouse


@router.get("/warehouses/{warehouse_id}", response_model=WarehouseRead)
def get_warehouse(
    warehouse_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:view")),
) -> WarehouseRead:
    _ = current_user
    return _get_or_404(db, Warehouse, warehouse_id, "Warehouse")


@router.get("/warehouses/{warehouse_id}/racks", response_model=list[RackRead])
def list_warehouse_racks(
    warehouse_id: int,
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:view")),
) -> list[RackRead]:
    _ = current_user
    _get_or_404(db, Warehouse, warehouse_id, "Warehouse")
    query = (
        db.query(Rack)
        .options(joinedload(Rack.warehouse))
        .filter(Rack.warehouse_id == warehouse_id)
        .order_by(Rack.rack_number.asc())
    )
    if not include_inactive:
        query = query.filter(Rack.is_active.is_(True))
    return query.all()


@router.put("/warehouses/{warehouse_id}", response_model=WarehouseRead)
def update_warehouse(
    warehouse_id: int,
    payload: WarehouseUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> WarehouseRead:
    _ = current_user
    warehouse = _get_or_404(db, Warehouse, warehouse_id, "Warehouse")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(warehouse, field, value)

    _commit_or_400(db, "Failed to update warehouse")
    db.refresh(warehouse)
    return warehouse


@router.get("/racks/{rack_id}", response_model=RackRead)
def get_rack(
    rack_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:view")),
) -> RackRead:
    _ = current_user
    rack = db.query(Rack).options(joinedload(Rack.warehouse)).filter(Rack.id == rack_id).first()
    if rack is None:
        raise AppException(error_code="NOT_FOUND", message="Rack not found", status_code=404)
    return rack


@router.put("/racks/{rack_id}", response_model=RackRead)
def update_rack(
    rack_id: int,
    payload: RackUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> RackRead:
    rack = _get_or_404(db, Rack, rack_id, "Rack")
    before_snapshot = snapshot_model(rack)
    changed_fields = payload.model_dump(exclude_unset=True)
    if "warehouse_id" in changed_fields:
        changed_fields["warehouse_id"] = _validate_default_warehouse_id(db, changed_fields["warehouse_id"])
    if "rack_number" in changed_fields:
        changed_fields["rack_number"] = _normalize_rack_number_value(changed_fields["rack_number"])
    for field, value in changed_fields.items():
        setattr(rack, field, value)

    _commit_or_400(
        db,
        "Failed to update rack. Rack number must be unique inside the warehouse",
        details={"field": "rack_number"},
    )
    write_audit_log(
        db,
        module="Masters",
        entity_type="RACK",
        entity_id=rack.id,
        action="UPDATE",
        performed_by=current_user.id,
        summary=f"Updated rack {rack.rack_number}",
        source_screen="Masters / Rack Numbers",
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(rack),
    )
    _commit_with_tenant_context(db)
    rack = (
        db.query(Rack)
        .options(joinedload(Rack.warehouse))
        .filter(Rack.id == rack.id)
        .first()
    )
    return rack


@router.delete("/racks/{rack_id}", response_model=RackRead)
def delete_rack(
    rack_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> RackRead:
    rack = _get_or_404(db, Rack, rack_id, "Rack")
    before_snapshot = snapshot_model(rack)
    rack.is_active = False
    _commit_or_400(db, "Failed to deactivate rack")
    write_audit_log(
        db,
        module="Masters",
        entity_type="RACK",
        entity_id=rack.id,
        action="DEACTIVATE",
        performed_by=current_user.id,
        summary=f"Deactivated rack {rack.rack_number}",
        source_screen="Masters / Rack Numbers",
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(rack),
    )
    _commit_with_tenant_context(db)
    rack = (
        db.query(Rack)
        .options(joinedload(Rack.warehouse))
        .filter(Rack.id == rack.id)
        .first()
    )
    return rack


@router.delete("/warehouses/{warehouse_id}", response_model=WarehouseDeleteResult)
def delete_warehouse(
    warehouse_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> WarehouseDeleteResult:
    _ = current_user
    warehouse = _get_or_404(db, Warehouse, warehouse_id, "Warehouse")
    return _delete_or_deactivate_warehouse(db, warehouse)


@router.post("/warehouses/bulk-delete", response_model=WarehouseBulkDeleteResult)
def bulk_delete_warehouses(
    payload: WarehouseBulkDeleteRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> WarehouseBulkDeleteResult:
    _ = current_user
    deleted_count = 0
    deactivated_count = 0
    errors: list[WarehouseBulkDeleteError] = []

    for warehouse_id in payload.ids:
        warehouse = db.get(Warehouse, warehouse_id)
        if warehouse is None:
            errors.append(
                WarehouseBulkDeleteError(
                    id=warehouse_id,
                    message="Warehouse not found",
                )
            )
            continue

        try:
            result = _delete_or_deactivate_warehouse(db, warehouse)
        except AppException as error:
            errors.append(
                WarehouseBulkDeleteError(
                    id=warehouse_id,
                    message=error.message,
                )
            )
            continue

        if result.action == "deleted":
            deleted_count += 1
        else:
            deactivated_count += 1

    return WarehouseBulkDeleteResult(
        deleted_count=deleted_count,
        deactivated_count=deactivated_count,
        failed_count=len(errors),
        errors=errors,
    )
