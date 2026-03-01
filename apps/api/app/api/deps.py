from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.core.database import get_db
from app.core.security import decode_access_token
from app.crud.user import get_user_by_id
from app.services.external_auth import get_or_create_rbac_shadow_user
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
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
