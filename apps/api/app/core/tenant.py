from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TypeVar

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import (
    IS_POSTGRES,
    SessionLocal,
    get_db,
    reset_search_path,
    set_tenant_search_path,
)
from app.core.exceptions import AppException
from app.core.security import decode_access_token
from app.core.tenancy import build_tenant_schema_name, quote_schema_name, validate_org_slug
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)
T = TypeVar("T")
_SCHEMA_COMPATIBILITY_CHECKED: set[str] = set()
settings = get_settings()


def get_token_payload(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if not credentials:
        raise AppException(
            error_code="UNAUTHORIZED",
            message="Not authenticated",
            status_code=401,
        )

    payload, _token_source = decode_access_token(credentials.credentials)
    if not payload:
        raise AppException(
            error_code="UNAUTHORIZED",
            message="Invalid token",
            status_code=401,
        )
    return payload


def resolve_request_tenant_schema(
    payload: dict = Depends(get_token_payload),
    db: Session = Depends(get_db),
) -> str | None:
    return _resolve_tenant_schema_from_payload(payload=payload, db=db, allow_superuser_bypass=True)


def ensure_tenant_db_context(
    db: Session = Depends(get_db),
    tenant_schema: str | None = Depends(resolve_request_tenant_schema),
) -> None:
    if tenant_schema is None:
        return

    set_tenant_search_path(db, tenant_schema)
    _ensure_runtime_schema_compatibility(db, tenant_schema)
    _assert_tenant_search_path(db, tenant_schema)


def validate_tenant_header_or_raise(authorization_header: str | None) -> None:
    if not authorization_header or not authorization_header.lower().startswith("bearer "):
        raise AppException(
            error_code="UNAUTHORIZED",
            message="Tenant routes require authentication",
            status_code=401,
        )

    token = authorization_header.split(" ", maxsplit=1)[1].strip()
    payload, _token_source = decode_access_token(token)
    if not payload:
        raise AppException(
            error_code="UNAUTHORIZED",
            message="Invalid token",
            status_code=401,
        )

    if not IS_POSTGRES:
        if "organizationId" in payload:
            org_slug = validate_org_slug(str(payload["organizationId"]))
            expected_schema = build_tenant_schema_name(org_slug)
            token_schema = payload.get("schemaName")
            if token_schema and token_schema != expected_schema:
                raise AppException(
                    error_code="FORBIDDEN",
                    message="Invalid tenant context",
                    status_code=403,
                )
        return

    with SessionLocal() as db:
        _resolve_tenant_schema_from_payload(payload=payload, db=db, allow_superuser_bypass=True)


def bootstrap_schema_compatibility() -> None:
    if not IS_POSTGRES:
        return

    with SessionLocal() as db:
        _ensure_runtime_schema_compatibility(db, "public")
        tenant_schemas = db.execute(
            text(
                """
                SELECT schema_name
                FROM public.organizations
                WHERE is_active IS TRUE
                """
            )
        ).scalars().all()

        for tenant_schema in tenant_schemas:
            if isinstance(tenant_schema, str):
                _ensure_runtime_schema_compatibility(db, tenant_schema)


def run_in_tenant_schema(schema_slug: str, func: Callable[[Session], T]) -> T:
    if not IS_POSTGRES:
        raise AppException(
            error_code="TENANCY_UNAVAILABLE",
            message="Tenant schema execution requires PostgreSQL",
            status_code=400,
        )

    safe_slug = validate_org_slug(schema_slug)
    schema_name = build_tenant_schema_name(safe_slug)

    with SessionLocal() as db:
        _validate_tenant_organization(db, safe_slug, schema_name)
        set_tenant_search_path(db, schema_name)
        _ensure_runtime_schema_compatibility(db, schema_name)
        _assert_tenant_search_path(db, schema_name)
        logger.info(
            "Running tenant-scoped unit of work",
            extra={"organization_slug": safe_slug, "schema": schema_name},
        )
        try:
            result = func(db)
            db.commit()
            return result
        except Exception:
            db.rollback()
            raise
        finally:
            reset_search_path(db)


def _resolve_tenant_schema_from_payload(
    *,
    payload: dict,
    db: Session,
    allow_superuser_bypass: bool,
) -> str | None:
    if "organizationId" not in payload:
        local_user = _get_local_user_from_payload(db, payload)
        if allow_superuser_bypass and _is_local_admin_user(local_user):
            return None
        if local_user and local_user.organization_slug:
            org_slug = validate_org_slug(local_user.organization_slug)
            expected_schema = build_tenant_schema_name(org_slug)
            if not IS_POSTGRES:
                return expected_schema
            if _allow_ephemeral_test_schema(db, org_slug, expected_schema):
                return expected_schema
            _validate_tenant_organization(db, org_slug, expected_schema)
            return expected_schema
        raise AppException(
            error_code="FORBIDDEN",
            message="Tenant context required",
            status_code=403,
        )

    org_slug = validate_org_slug(str(payload["organizationId"]))
    expected_schema = build_tenant_schema_name(org_slug)
    token_schema = payload.get("schemaName")
    if token_schema and token_schema != expected_schema:
        raise AppException(
            error_code="FORBIDDEN",
            message="Invalid tenant context",
            status_code=403,
        )

    if not IS_POSTGRES:
        return expected_schema

    if _allow_ephemeral_test_schema(db, org_slug, expected_schema):
        return expected_schema

    _validate_tenant_organization(db, org_slug, expected_schema)
    logger.info(
        "Validated tenant schema context",
        extra={"organization_slug": org_slug, "schema": expected_schema},
    )
    return expected_schema


def _get_local_user_from_payload(db: Session, payload: dict) -> User | None:
    subject = payload.get("sub")
    if subject is None:
        return None

    try:
        user_id = int(subject)
    except (TypeError, ValueError):
        return None

    return db.query(User).filter(User.id == user_id).first()


def _is_local_admin_user(user: User | None) -> bool:
    if not user:
        return False

    if user.is_superuser:
        return True

    role_names = {
        role.name
        for role in user.effective_roles
        if getattr(role, "name", None)
    }
    return "ADMIN" in role_names


def _validate_tenant_organization(db: Session, org_slug: str, expected_schema: str) -> None:
    result = db.execute(
        text(
            """
            SELECT id, schema_name, is_active
            FROM public.organizations
            WHERE id = :org_slug
            """
        ),
        {"org_slug": org_slug},
    ).mappings().first()

    if not result or not bool(result["is_active"]):
        raise AppException(
            error_code="FORBIDDEN",
            message="Organization context is invalid",
            status_code=403,
        )

    if result["schema_name"] != expected_schema:
        raise AppException(
            error_code="FORBIDDEN",
            message="Tenant schema does not match token context",
            status_code=403,
        )

    schema_exists = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.schemata
            WHERE schema_name = :schema_name
            """
        ),
        {"schema_name": expected_schema},
    ).scalar_one_or_none()
    if schema_exists is None:
        raise AppException(
            error_code="FORBIDDEN",
            message="Tenant schema does not exist",
            status_code=403,
        )


def _assert_tenant_search_path(db: Session, expected_schema: str) -> None:
    if not IS_POSTGRES:
        return

    active_search_path = str(
        db.execute(text("SELECT current_setting('search_path')")).scalar_one()
    )
    normalized = [segment.strip().strip('"') for segment in active_search_path.split(",")]
    if not normalized or normalized[0] != expected_schema:
        raise AppException(
            error_code="TENANT_CONTEXT_MISMATCH",
            message="Database search_path is not bound to the expected tenant",
            status_code=500,
        )


def _ensure_runtime_schema_compatibility(db: Session, schema_name: str) -> None:
    if not IS_POSTGRES or schema_name in _SCHEMA_COMPATIBILITY_CHECKED:
        return

    products_table_exists = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = :schema_name
              AND table_name = 'products'
            """
        ),
        {"schema_name": schema_name},
    ).scalar_one_or_none()

    if products_table_exists is None:
        return

    quantity_precision_exists = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = :schema_name
              AND table_name = 'products'
              AND column_name = 'quantity_precision'
            """
        ),
        {"schema_name": schema_name},
    ).scalar_one_or_none()

    if quantity_precision_exists is None:
        db.execute(
            text(
                f"""
                ALTER TABLE {_build_quoted_schema_table(schema_name, "products")}
                ADD COLUMN IF NOT EXISTS quantity_precision INTEGER NOT NULL DEFAULT 0
                """
            )
        )
        db.commit()
        logger.warning(
            "Auto-repaired tenant schema to add missing products.quantity_precision",
            extra={"schema": schema_name},
        )

    parties_table_exists = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = :schema_name
              AND table_name = 'parties'
            """
        ),
        {"schema_name": schema_name},
    ).scalar_one_or_none()

    if parties_table_exists is not None:
        gstin_exists = db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'parties'
                  AND column_name = 'gstin'
                """
            ),
            {"schema_name": schema_name},
        ).scalar_one_or_none()

        if gstin_exists is None:
            db.execute(
                text(
                    f"""
                    ALTER TABLE {_build_quoted_schema_table(schema_name, "parties")}
                    ADD COLUMN IF NOT EXISTS gstin VARCHAR(15)
                    """
                )
            )
            db.commit()
            logger.warning(
                "Auto-repaired tenant schema to add missing parties.gstin",
                extra={"schema": schema_name},
            )

        pan_exists = db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'parties'
                  AND column_name = 'pan_number'
                """
            ),
            {"schema_name": schema_name},
        ).scalar_one_or_none()

        if pan_exists is None:
            db.execute(
                text(
                    f"""
                    ALTER TABLE {_build_quoted_schema_table(schema_name, "parties")}
                    ADD COLUMN IF NOT EXISTS pan_number VARCHAR(10)
                    """
                )
            )
            db.commit()
            logger.warning(
                "Auto-repaired tenant schema to add missing parties.pan_number",
                extra={"schema": schema_name},
            )

        state_exists = db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'parties'
                  AND column_name = 'state'
                """
            ),
            {"schema_name": schema_name},
        ).scalar_one_or_none()

        if state_exists is None:
            db.execute(
                text(
                    f"""
                    ALTER TABLE {_build_quoted_schema_table(schema_name, "parties")}
                    ADD COLUMN IF NOT EXISTS state VARCHAR(120)
                    """
                )
            )
            db.commit()
            logger.warning(
                "Auto-repaired tenant schema to add missing parties.state",
                extra={"schema": schema_name},
            )

        city_exists = db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'parties'
                  AND column_name = 'city'
                """
            ),
            {"schema_name": schema_name},
        ).scalar_one_or_none()

        if city_exists is None:
            db.execute(
                text(
                    f"""
                    ALTER TABLE {_build_quoted_schema_table(schema_name, "parties")}
                    ADD COLUMN IF NOT EXISTS city VARCHAR(120)
                    """
                )
            )
            db.commit()
            logger.warning(
                "Auto-repaired tenant schema to add missing parties.city",
                extra={"schema": schema_name},
            )

        pincode_exists = db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'parties'
                  AND column_name = 'pincode'
                """
            ),
            {"schema_name": schema_name},
        ).scalar_one_or_none()

        if pincode_exists is None:
            db.execute(
                text(
                    f"""
                    ALTER TABLE {_build_quoted_schema_table(schema_name, "parties")}
                    ADD COLUMN IF NOT EXISTS pincode VARCHAR(10)
                    """
                )
            )
            db.commit()
            logger.warning(
                "Auto-repaired tenant schema to add missing parties.pincode",
                extra={"schema": schema_name},
            )

    _SCHEMA_COMPATIBILITY_CHECKED.add(schema_name)


def _build_quoted_schema_table(schema_name: str, table_name: str) -> str:
    return f'{quote_schema_name(schema_name)}.{table_name}'


def _allow_ephemeral_test_schema(db: Session, org_slug: str, expected_schema: str) -> bool:
    if not settings.enable_test_endpoints:
        return False
    if not org_slug.startswith("e2e_"):
        return False

    schema_exists = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.schemata
            WHERE schema_name = :schema_name
            """
        ),
        {"schema_name": expected_schema},
    ).scalar_one_or_none()
    return schema_exists is not None
