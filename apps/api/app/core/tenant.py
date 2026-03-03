from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TypeVar

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import (
    IS_POSTGRES,
    SessionLocal,
    get_db,
    reset_search_path,
    set_tenant_search_path,
)
from app.core.exceptions import AppException
from app.core.security import decode_access_token
from app.core.tenancy import build_tenant_schema_name, validate_org_slug
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)
T = TypeVar("T")


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
