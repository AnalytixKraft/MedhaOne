import csv
import io
from decimal import Decimal, InvalidOperation
from enum import Enum

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db, set_tenant_search_path
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.domain.quantity import infer_quantity_precision_from_uom
from app.domain.tax_identity import (
    derive_state_from_gstin,
    extract_pan_from_gstin,
    normalize_and_validate_gstin,
    normalize_optional_text,
)
from app.models.enums import OutstandingTrackingMode, PartyCategory, PartyType, RegistrationType
from app.models.party import Party
from app.models.product import Product
from app.models.tax_rate import TaxRate
from app.models.warehouse import Warehouse
from app.schemas.masters import (
    BulkImportError,
    BulkImportResult,
    PartyCreate,
    PartyRead,
    PartyUpdate,
    ProductCreate,
    ProductRead,
    ProductUpdate,
    WarehouseCreate,
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

PARTY_WRITE_FIELDS = {
    "name",
    "display_name",
    "party_code",
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


def _normalize_party_payload(payload: dict) -> dict:
    normalized = dict(payload)
    raw_party_type = _to_text(normalized.get("party_type")).upper()
    raw_party_category = _to_text(normalized.get("party_category")).upper()

    if raw_party_type in LEGACY_PARTY_TYPE_MAP:
        normalized_type, normalized_category = LEGACY_PARTY_TYPE_MAP[raw_party_type]
        normalized["party_type"] = normalized_type.value
        if not raw_party_category and normalized_category is not None:
            normalized["party_category"] = normalized_category.value
    elif raw_party_type:
        normalized["party_type"] = PartyType(raw_party_type).value
    elif raw_party_category in CUSTOMER_PARTY_CATEGORIES:
        normalized["party_type"] = PartyType.CUSTOMER.value
    elif raw_party_category in SUPPLIER_PARTY_CATEGORIES:
        normalized["party_type"] = PartyType.SUPPLIER.value
    else:
        normalized["party_type"] = PartyType.BOTH.value

    if raw_party_category:
        normalized["party_category"] = PartyCategory(raw_party_category).value
    else:
        normalized["party_category"] = _to_nullable_text(normalized.get("party_category"))

    normalized["name"] = _to_text(normalized.get("party_name") or normalized.get("name"))
    normalized["display_name"] = _to_nullable_text(normalized.get("display_name"))
    normalized["party_code"] = _to_nullable_text(normalized.get("party_code"))
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
    normalized["fssai_number"] = _to_nullable_text(normalized.get("fssai_number"))
    normalized["udyam_number"] = _to_nullable_text(normalized.get("udyam_number"))
    normalized["payment_terms"] = _to_nullable_text(normalized.get("payment_terms"))
    normalized["credit_limit"] = normalized.get("credit_limit") or Decimal("0.00")
    normalized["opening_balance"] = normalized.get("opening_balance") or Decimal("0.00")

    gstin = normalize_and_validate_gstin(normalized.get("gstin"))
    if gstin:
        normalized["gstin"] = gstin
        normalized["pan_number"] = extract_pan_from_gstin(gstin)
        if not normalized.get("state"):
            normalized["state"] = derive_state_from_gstin(gstin)
        if not normalized.get("registration_type"):
            normalized["registration_type"] = RegistrationType.REGISTERED.value
    else:
        normalized["gstin"] = None
        normalized["pan_number"] = normalize_optional_text(normalized.get("pan_number"))
        registration_type = _to_text(normalized.get("registration_type")).upper()
        normalized["registration_type"] = (
            RegistrationType(registration_type).value if registration_type else None
        )

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
    party_code: str | None,
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
    if party_code:
        query = db.query(Party.id).filter(func.upper(Party.party_code) == party_code.upper())
        if exclude_party_id is not None:
            query = query.filter(Party.id != exclude_party_id)
        if query.first() is not None:
            raise AppException(
                error_code="VALIDATION_ERROR",
                message="Party Code already exists",
                status_code=status.HTTP_400_BAD_REQUEST,
                details={"field": "party_code"},
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
    if isinstance(value, Enum):
        return str(value.value).strip()
    return str(value).strip()


def _to_nullable_text(value: object) -> str | None:
    text = _to_text(value)
    return text or None


@router.get("/parties", response_model=list[PartyRead])
def list_parties(
    include_inactive: bool = Query(default=False),
    party_type: PartyType | None = Query(default=None),
    party_category: PartyCategory | None = Query(default=None),
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
        query = query.filter(Party.party_category == party_category.value)
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


@router.post("/parties", response_model=PartyRead, status_code=status.HTTP_201_CREATED)
def create_party(
    payload: PartyCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("party:create")),
) -> PartyRead:
    party_payload = _normalize_party_payload(payload.model_dump())
    _ensure_unique_party_identifiers(
        db,
        gstin=party_payload.get("gstin"),
        party_code=party_payload.get("party_code"),
    )
    party = Party(**party_payload)
    db.add(party)
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
        "party_code": party.party_code,
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
    _ensure_unique_party_identifiers(
        db,
        gstin=updates.get("gstin"),
        party_code=updates.get("party_code"),
        exclude_party_id=party.id,
    )

    for field, value in updates.items():
        setattr(party, field, value)

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
            "party_code": _to_text(row.get("party_code")) or None,
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
                _ensure_unique_party_identifiers(
                    db,
                    gstin=party_model_payload.get("gstin"),
                    party_code=party_model_payload.get("party_code"),
                )
                party = Party(**party_model_payload)
                db.add(party)
                db.flush()
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


@router.get("/products", response_model=list[ProductRead])
def list_products(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:view")),
) -> list[ProductRead]:
    _ = current_user
    query = db.query(Product).order_by(Product.name.asc())
    if not include_inactive:
        query = query.filter(Product.is_active.is_(True))
    return query.all()


@router.post("/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> ProductRead:
    product = Product(**payload.model_dump())
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
            quantity_precision_text = _to_text(row.get("quantity_precision"))
            with db.begin_nested():
                product_input = ProductCreate(
                    sku=sku,
                    name=_to_text(row.get("name")),
                    brand=_to_text(row.get("brand")) or None,
                    uom=_to_text(row.get("uom")),
                    quantity_precision=(
                        int(quantity_precision_text) if quantity_precision_text else None
                    ),
                    barcode=_to_text(row.get("barcode")) or None,
                    hsn=_to_text(row.get("hsn")) or None,
                    gst_rate=gst_rate_value,
                    is_active=True,
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
    return _get_or_404(db, Product, product_id, "Product")


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
    for field, value in changed_fields.items():
        setattr(product, field, value)

    if "uom" in changed_fields and "quantity_precision" not in changed_fields:
        product.quantity_precision = infer_quantity_precision_from_uom(product.uom)

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
            "sku,name,uom,price,gst_rate,hsn,brand",
            "SKU001,Paracetamol 500,PCS,12.50,5,3004,Medha",
            "SKU002,Crocin Tablet,BOX,45,12,3004,Medha",
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


@router.delete("/warehouses/{warehouse_id}", response_model=WarehouseRead)
def delete_warehouse(
    warehouse_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> WarehouseRead:
    _ = current_user
    warehouse = _get_or_404(db, Warehouse, warehouse_id, "Warehouse")
    warehouse.is_active = False
    _commit_or_400(db, "Failed to deactivate warehouse")
    db.refresh(warehouse)
    return warehouse
