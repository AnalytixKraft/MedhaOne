from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.database import get_db as _get_db
from app.core.database import get_public_db
from app.core.exceptions import AppException
from app.core.tenant import ensure_tenant_db_context, get_token_payload
from app.core.tenant import resolve_request_tenant_schema as _resolve_request_tenant_schema
from app.crud.user import get_user_by_id
from app.models.user import User
from app.services.external_auth import get_or_create_rbac_shadow_user

get_db = _get_db
get_db_with_schema = ensure_tenant_db_context
resolve_request_tenant_schema = _resolve_request_tenant_schema


def get_current_user(
    payload: dict = Depends(get_token_payload),
    db: Session = Depends(get_public_db),
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
