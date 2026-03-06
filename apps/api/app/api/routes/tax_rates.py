from decimal import Decimal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import set_tenant_search_path
from app.core.database import get_db
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.models.tax_rate import TaxRate
from app.models.user import User
from app.schemas.tax_rate import TaxRateCreate, TaxRateRead, TaxRateUpdate
from app.services.tax_rates import initialize_tenant_tax_rates

router = APIRouter()


@router.get("", response_model=list[TaxRateRead])
def list_tax_rates(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("tax:view")),
) -> list[TaxRateRead]:
    _ = current_user
    initialize_tenant_tax_rates(db)

    query = db.query(TaxRate).order_by(TaxRate.rate_percent.asc(), TaxRate.code.asc())
    if not include_inactive:
        query = query.filter(TaxRate.is_active.is_(True))
    return query.all()


@router.post("", response_model=TaxRateRead, status_code=status.HTTP_201_CREATED)
def create_tax_rate(
    payload: TaxRateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("tax:manage")),
) -> TaxRateRead:
    _ = current_user
    initialize_tenant_tax_rates(db)
    _guard_duplicate_active_rate(db, payload.rate_percent)

    record = TaxRate(**payload.model_dump())
    db.add(record)
    _commit_or_validation_error(db, "Failed to create tax rate")
    db.refresh(record)
    return record


@router.patch("/{tax_rate_id}", response_model=TaxRateRead)
def update_tax_rate(
    tax_rate_id: int,
    payload: TaxRateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("tax:manage")),
) -> TaxRateRead:
    _ = current_user
    initialize_tenant_tax_rates(db)

    record = db.get(TaxRate, tax_rate_id)
    if not record:
        raise AppException(
            error_code="NOT_FOUND",
            message="Tax rate not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    updates = payload.model_dump(exclude_unset=True)
    target_rate = Decimal(str(updates.get("rate_percent", record.rate_percent)))
    target_active = bool(updates.get("is_active", record.is_active))
    if target_active:
        _guard_duplicate_active_rate(db, target_rate, exclude_id=record.id)

    for field, value in updates.items():
        setattr(record, field, value)

    _commit_or_validation_error(db, "Failed to update tax rate")
    db.refresh(record)
    return record


@router.delete("/{tax_rate_id}", response_model=TaxRateRead)
def deactivate_tax_rate(
    tax_rate_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("tax:manage")),
) -> TaxRateRead:
    _ = current_user
    initialize_tenant_tax_rates(db)

    record = db.get(TaxRate, tax_rate_id)
    if not record:
        raise AppException(
            error_code="NOT_FOUND",
            message="Tax rate not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )

    record.is_active = False
    _commit_or_validation_error(db, "Failed to deactivate tax rate")
    db.refresh(record)
    return record


def _guard_duplicate_active_rate(
    db: Session,
    rate_percent: Decimal,
    *,
    exclude_id: int | None = None,
) -> None:
    query = db.query(TaxRate).filter(
        TaxRate.rate_percent == rate_percent,
        TaxRate.is_active.is_(True),
    )
    if exclude_id is not None:
        query = query.filter(TaxRate.id != exclude_id)

    exists = query.first()
    if exists:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="An active tax rate with the same percent already exists",
            status_code=status.HTTP_400_BAD_REQUEST,
            details={"field": "rate_percent"},
        )


def _commit_or_validation_error(db: Session, message: str) -> None:
    try:
        db.commit()
        tenant_schema = db.info.get("tenant_schema")
        if isinstance(tenant_schema, str) and tenant_schema:
            # Re-apply tenant scope after commit; pooled checkout resets to public.
            set_tenant_search_path(db, tenant_schema)
    except IntegrityError as error:
        db.rollback()
        raise AppException(
            error_code="VALIDATION_ERROR",
            message=message,
            status_code=status.HTTP_400_BAD_REQUEST,
        ) from error
