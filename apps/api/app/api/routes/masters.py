import csv
import io
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.domain.quantity import infer_quantity_precision_from_uom
from app.domain.tax_identity import (
    derive_state_from_gstin,
    extract_pan_from_gstin,
    normalize_and_validate_gstin,
    normalize_optional_text,
)
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

router = APIRouter()


def _commit_or_400(db: Session, error_message: str, details: dict | None = None) -> None:
    try:
        db.commit()
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
    normalized["phone"] = _to_nullable_text(normalized.get("phone"))
    normalized["state"] = _to_nullable_text(normalized.get("state"))
    normalized["city"] = _to_nullable_text(normalized.get("city"))
    normalized["pincode"] = _to_nullable_text(normalized.get("pincode"))
    gstin = normalize_and_validate_gstin(normalized.get("gstin"))
    if gstin:
        normalized["gstin"] = gstin
        normalized["pan_number"] = extract_pan_from_gstin(gstin)
        if not normalized.get("state"):
            normalized["state"] = derive_state_from_gstin(gstin)
    else:
        normalized["gstin"] = None
        normalized["pan_number"] = normalize_optional_text(normalized.get("pan_number"))
    return normalized


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


def _to_nullable_text(value: object) -> str | None:
    text = _to_text(value)
    return text or None


@router.get("/parties", response_model=list[PartyRead])
def list_parties(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:view")),
) -> list[PartyRead]:
    _ = current_user
    query = db.query(Party).order_by(Party.name.asc())
    if not include_inactive:
        query = query.filter(Party.is_active.is_(True))
    return query.all()


@router.post("/parties", response_model=PartyRead, status_code=status.HTTP_201_CREATED)
def create_party(
    payload: PartyCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> PartyRead:
    _ = current_user
    party = Party(**_normalize_party_payload(payload.model_dump()))
    db.add(party)
    _commit_or_400(db, "Failed to create party")
    db.refresh(party)
    return party


@router.get("/parties/{party_id}", response_model=PartyRead)
def get_party(
    party_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:view")),
) -> PartyRead:
    _ = current_user
    return _get_or_404(db, Party, party_id, "Party")


@router.put("/parties/{party_id}", response_model=PartyRead)
def update_party(
    party_id: int,
    payload: PartyUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> PartyRead:
    _ = current_user
    party = _get_or_404(db, Party, party_id, "Party")
    updates = payload.model_dump(exclude_unset=True)
    if "gstin" in updates:
        normalized_gstin = normalize_and_validate_gstin(updates.get("gstin"))
        party.gstin = normalized_gstin
        if normalized_gstin:
            party.pan_number = extract_pan_from_gstin(normalized_gstin)
            if "state" not in updates or not _to_text(updates.get("state")):
                party.state = derive_state_from_gstin(normalized_gstin)
        else:
            party.pan_number = normalize_optional_text(updates.get("pan_number"))

    if "pan_number" in updates and "gstin" not in updates and not party.gstin:
        party.pan_number = normalize_optional_text(updates.get("pan_number"))

    if "state" in updates:
        party.state = _to_nullable_text(updates.get("state"))
    if "city" in updates:
        party.city = _to_nullable_text(updates.get("city"))
    if "pincode" in updates:
        party.pincode = _to_nullable_text(updates.get("pincode"))
    if "phone" in updates:
        party.phone = _to_nullable_text(updates.get("phone"))

    for field, value in updates.items():
        if field in {"gstin", "pan_number", "state", "city", "pincode", "phone"}:
            continue
        setattr(party, field, value)

    _commit_or_400(db, "Failed to update party")
    db.refresh(party)
    return party


@router.post("/parties/bulk", response_model=BulkImportResult)
async def bulk_create_parties(
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> BulkImportResult:
    _ = current_user
    rows = await _read_bulk_rows(request)
    errors: list[BulkImportError] = []
    created_count = 0

    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            errors.append(_bulk_error(index, "Row must be an object"))
            continue

        row_payload = {
            "name": _to_text(row.get("name")),
            "party_type": _to_text(row.get("party_type") or row.get("type")) or "DISTRIBUTOR",
            "phone": _to_text(row.get("phone")) or None,
            "email": _to_text(row.get("email")) or None,
            "address": _to_text(row.get("address")) or None,
            "state": _to_text(row.get("state")) or None,
            "city": _to_text(row.get("city")) or None,
            "pincode": _to_text(row.get("pincode")) or None,
            "gstin": _to_text(row.get("gstin")) or None,
            "pan_number": _to_text(row.get("pan_number")) or None,
            "is_active": True,
        }

        try:
            with db.begin_nested():
                party_input = PartyCreate(**row_payload)
                party_model_payload = _normalize_party_payload(party_input.model_dump())
                party = Party(**party_model_payload)
                db.add(party)
                db.flush()
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

    return BulkImportResult(
        created_count=created_count,
        failed_count=len(errors),
        errors=errors,
    )


@router.delete("/parties/{party_id}", response_model=PartyRead)
def delete_party(
    party_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> PartyRead:
    _ = current_user
    party = _get_or_404(db, Party, party_id, "Party")
    party.is_active = False
    _commit_or_400(db, "Failed to deactivate party")
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
    _ = current_user
    product = Product(**payload.model_dump())
    db.add(product)
    _commit_or_400(
        db,
        "Failed to create product. SKU must be unique",
        details={"field": "sku"},
    )
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
    _ = current_user
    product = _get_or_404(db, Product, product_id, "Product")
    changed_fields = payload.model_dump(exclude_unset=True)
    for field, value in changed_fields.items():
        setattr(product, field, value)

    if "uom" in changed_fields and "quantity_precision" not in changed_fields:
        product.quantity_precision = infer_quantity_precision_from_uom(product.uom)

    _commit_or_400(db, "Failed to update product")
    db.refresh(product)
    return product


@router.delete("/products/{product_id}", response_model=ProductRead)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("masters:manage")),
) -> ProductRead:
    _ = current_user
    product = _get_or_404(db, Product, product_id, "Product")
    product.is_active = False
    _commit_or_400(db, "Failed to deactivate product")
    db.refresh(product)
    return product


@router.get("/templates/party-import.csv")
def party_import_template(
    current_user=Depends(require_permission("masters:view")),
) -> Response:
    _ = current_user
    csv_data = "\n".join(
        [
            "name,party_type,gstin,phone,email,address,state,city,pincode",
            "ABC Traders,DISTRIBUTOR,27ABCDE1234F1Z5,9876543210,abc@example.com,Camp Pune,Maharashtra,Pune,411045",
            "XYZ Pharma,PHARMACY,29AAAPL1234C1Z3,9999999999,xyz@example.com,MG Road Bengaluru,Karnataka,Bengaluru,560001",
        ]
    )
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="party-import.csv"'},
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
