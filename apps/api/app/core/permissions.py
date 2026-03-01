from fastapi import Depends

from app.api.deps import get_current_user
from app.core.exceptions import AppException
from app.models.user import User


def require_permission(permission_code: str):
    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.is_superuser:
            return current_user

        if permission_code in set(current_user.permissions):
            return current_user

        raise AppException(
            error_code="FORBIDDEN",
            message="Permission denied",
            status_code=403,
        )

    return dependency
