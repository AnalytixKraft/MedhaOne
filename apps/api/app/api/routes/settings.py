from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends

from app.api.deps import get_db_with_schema, get_current_user
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.models.audit import AuditLog
from app.models.company_settings import CompanySettings
from app.models.user import User
from app.schemas.settings import CompanySettingsRead, CompanySettingsUpdate

router = APIRouter()


@router.get("/company", response_model=CompanySettingsRead)
def get_company_settings(
    current_user: User = Depends(require_permission("settings:view")),
    db: Session = Depends(get_db_with_schema),
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
    db: Session = Depends(get_db_with_schema),
) -> CompanySettingsRead:
    _require_tenant_context(current_user)
    _ensure_company_settings_table(db)

    settings = db.query(CompanySettings).filter(CompanySettings.id == 1).first()
    if settings is None:
        settings = CompanySettings(id=1)
        db.add(settings)
        db.flush()

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(settings, field, value)

    db.add(
        AuditLog(
            entity_type="COMPANY_SETTINGS",
            entity_id=1,
            action="UPDATE",
            performed_by=current_user.id,
            metadata_json={
                "updated_fields": sorted(updates.keys()),
                "organization_slug": current_user.organization_slug,
            },
        )
    )
    db.commit()
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
    db.flush()


def _to_response(db: Session, current_user: User, settings: CompanySettings) -> CompanySettingsRead:
    organization_name = None
    if current_user.organization_slug:
        try:
            organization_name = (
                db.execute(
                    text("SELECT name FROM organizations WHERE id = :organization_slug"),
                    {"organization_slug": current_user.organization_slug},
                ).scalar_one_or_none()
            )
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
        phone=settings.phone,
        email=settings.email,
        logo_url=settings.logo_url,
        created_at=settings.created_at,
        updated_at=settings.updated_at,
    )
