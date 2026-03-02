import logging

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import IS_POSTGRES, get_db, set_tenant_search_path
from app.core.exceptions import AppException
from app.core.security import decode_access_token
from app.core.tenancy import build_tenant_schema_name, validate_org_slug
from app.crud.user import get_user_by_id
from app.models.user import User
from app.services.external_auth import get_or_create_rbac_shadow_user

bearer_scheme = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)


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
    if "organizationId" not in payload:
        return None

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
        # SQLite test mode cannot enforce schema switching; production PostgreSQL can.
        return expected_schema

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

    logger.info("Applying tenant schema", extra={"organization_slug": org_slug, "schema": expected_schema})
    return expected_schema


def get_db_with_schema(
    db: Session = Depends(get_db),
    tenant_schema: str | None = Depends(resolve_request_tenant_schema),
):
    if tenant_schema:
        set_tenant_search_path(db, tenant_schema)
    return db


def get_current_user(
    payload: dict = Depends(get_token_payload),
    db: Session = Depends(get_db),
) -> User:
    if "sub" in payload:
        user = get_user_by_id(db, int(payload["sub"]))
    elif "userId" in payload and "organizationId" in payload:
        user = get_or_create_rbac_shadow_user(db, payload)
    else:
        user = None

    if not user:
        raise AppException(
            error_code="UNAUTHORIZED",
            message="User not found",
            status_code=401,
        )

    if not user.is_active:
        raise AppException(
            error_code="FORBIDDEN",
            message="User is inactive",
            status_code=403,
        )

    return user
