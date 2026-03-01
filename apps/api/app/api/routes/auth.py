from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.exceptions import AppException
from app.core.security import create_access_token, verify_password
from app.crud.user import get_user_by_email
from app.models.login_audit import LoginAudit
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse
from app.schemas.user import UserRead
from app.services.external_auth import login_via_rbac
from app.services.rbac import bootstrap_rbac_if_ready, ensure_admin_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> TokenResponse:
    if payload.organization_slug:
        token = login_via_rbac(
            email=payload.email,
            password=payload.password,
            organization_slug=payload.organization_slug,
        )
        return TokenResponse(access_token=token)

    bootstrap_rbac_if_ready()
    if db.query(User).filter(User.auth_provider == "LOCAL").first() is None:
        ensure_admin_user(db)

    user = get_user_by_email(db, payload.email)
    if not user:
        token = login_via_rbac(
            email=payload.email,
            password=payload.password,
            organization_slug=None,
        )
        return TokenResponse(access_token=token)

    if not verify_password(payload.password, user.hashed_password):
        raise AppException(
            error_code="UNAUTHORIZED",
            message="Invalid credentials",
            status_code=401,
        )

    if not user.is_active:
        raise AppException(
            error_code="FORBIDDEN",
            message="User is inactive",
            status_code=403,
        )

    forwarded_for = request.headers.get("x-forwarded-for")
    real_ip = request.headers.get("x-real-ip")
    ip_address = (
        (forwarded_for.split(",")[0].strip() if forwarded_for else None)
        or real_ip
        or (request.client.host if request.client else None)
        or "unknown"
    )
    user_agent = request.headers.get("user-agent")

    try:
        user.last_login_at = datetime.now(timezone.utc)
        db.add(
            LoginAudit(
                user_id=user.id,
                email=user.email,
                ip_address=ip_address,
                user_agent=user_agent,
            )
        )
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        raise AppException(
            error_code="INTERNAL_ERROR",
            message="Failed to persist login audit",
            status_code=500,
        ) from error

    token = create_access_token(str(user.id))
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserRead)
def me(current_user=Depends(get_current_user)) -> UserRead:
    return current_user
