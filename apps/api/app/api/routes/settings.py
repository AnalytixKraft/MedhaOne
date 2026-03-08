from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db, set_tenant_search_path
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.domain.tax_identity import (
    derive_state_from_gstin,
    extract_pan_from_gstin,
    normalize_and_validate_gstin,
    normalize_optional_text,
)
from app.models.company_settings import CompanySettings
from app.models.user import User
from app.schemas.settings import CompanySettingsRead, CompanySettingsUpdate
from app.services.audit import snapshot_model, write_audit_log

router = APIRouter()


@router.get("/company", response_model=CompanySettingsRead)
def get_company_settings(
    current_user: User = Depends(require_permission("settings:view")),
    db: Session = Depends(get_db),
) -> CompanySettingsRead:
    _require_tenant_context(current_user)
    _ensure_company_settings_table(db)

    settings = db.query(CompanySettings).filter(CompanySettings.id == 1).first()
    if settings is None:
        settings = CompanySettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)

    return _to_response(db, current_user, settings)


@router.put("/company", response_model=CompanySettingsRead)
def update_company_settings(
    payload: CompanySettingsUpdate,
    current_user: User = Depends(require_permission("settings:update")),
    db: Session = Depends(get_db),
) -> CompanySettingsRead:
    _require_tenant_context(current_user)
    _ensure_company_settings_table(db)

    settings = db.query(CompanySettings).filter(CompanySettings.id == 1).first()
    if settings is None:
        settings = CompanySettings(id=1)
        db.add(settings)
        db.flush()

    before_snapshot = snapshot_model(settings)
    updates = payload.model_dump(exclude_unset=True)
    if "gst_number" in updates:
        normalized_gstin = normalize_and_validate_gstin(updates.get("gst_number"))
        settings.gst_number = normalized_gstin
        if normalized_gstin:
            settings.pan_number = extract_pan_from_gstin(normalized_gstin)
            if "state" not in updates or not normalize_optional_text(updates.get("state")):
                settings.state = derive_state_from_gstin(normalized_gstin)
        else:
            settings.pan_number = normalize_optional_text(updates.get("pan_number"))

    if "pan_number" in updates and "gst_number" not in updates and not settings.gst_number:
        settings.pan_number = normalize_optional_text(updates.get("pan_number"))

    for field, value in updates.items():
        if field in {"gst_number", "pan_number"}:
            continue
        normalized_value = value.strip() or None if isinstance(value, str) else value
        setattr(settings, field, normalized_value)

    db.commit()
    _restore_tenant_search_path(db)
    _write_company_settings_audit_log_safe(
        db,
        module="Settings",
        entity_type="COMPANY_SETTINGS",
        entity_id=1,
        action="UPDATE",
        performed_by=current_user.id,
        summary="Updated company settings",
        source_screen="Settings / Company Profile",
        before_snapshot=before_snapshot,
        after_snapshot=snapshot_model(settings),
        metadata={
            "updated_fields": sorted(updates.keys()),
            "organization_slug": current_user.organization_slug,
        },
    )
    db.refresh(settings)
    return _to_response(db, current_user, settings)


def _require_tenant_context(current_user: User) -> None:
    if not current_user.organization_slug:
        raise AppException(
            error_code="FORBIDDEN",
            message="Tenant context required",
            status_code=403,
        )


def _ensure_company_settings_table(db: Session) -> None:
    # Older tenant schemas created before this table existed need a one-time compatibility backfill.
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS company_settings (
              id INTEGER PRIMARY KEY,
              company_name VARCHAR(255),
              address TEXT,
              city VARCHAR(120),
              state VARCHAR(120),
              pincode VARCHAR(20),
              gst_number VARCHAR(64),
              pan_number VARCHAR(10),
              phone VARCHAR(30),
              email VARCHAR(255),
              logo_url TEXT,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT ck_company_settings_single_row CHECK (id = 1)
            )
            """
        )
    )
    db.execute(text("ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS pan_number VARCHAR(10)"))
    db.flush()


def _to_response(db: Session, current_user: User, settings: CompanySettings) -> CompanySettingsRead:
    organization_name = None
    if current_user.organization_slug:
        try:
            organization_name = db.execute(
                text("SELECT name FROM organizations WHERE id = :organization_slug"),
                {"organization_slug": current_user.organization_slug},
            ).scalar_one_or_none()
        except SQLAlchemyError:
            organization_name = current_user.organization_slug.replace("_", " ").title()

    return CompanySettingsRead(
        organization_name=organization_name,
        company_name=settings.company_name,
        address=settings.address,
        city=settings.city,
        state=settings.state,
        pincode=settings.pincode,
        gst_number=settings.gst_number,
        pan_number=settings.pan_number,
        phone=settings.phone,
        email=settings.email,
        logo_url=settings.logo_url,
        created_at=settings.created_at,
        updated_at=settings.updated_at,
    )


def _restore_tenant_search_path(db: Session) -> None:
    tenant_schema = db.info.get("tenant_schema")
    if isinstance(tenant_schema, str) and tenant_schema:
        set_tenant_search_path(db, tenant_schema)


def _write_company_settings_audit_log_safe(db: Session, **kwargs) -> None:
    try:
        write_audit_log(db, **kwargs)
        db.commit()
        _restore_tenant_search_path(db)
    except Exception:
        # Company profile updates must succeed even if audit persistence fails in legacy schemas.
        db.rollback()
        _restore_tenant_search_path(db)
