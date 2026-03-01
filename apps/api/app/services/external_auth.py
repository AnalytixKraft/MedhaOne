from __future__ import annotations

from secrets import token_urlsafe
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.core.security import get_password_hash
from app.crud.user import get_any_user_by_email, get_user_by_external_subject, get_user_by_id
from app.models.user import User
from app.services.rbac import assign_roles_to_user, ensure_rbac_seeded

RBAC_TO_LOCAL_ROLE = {
    "ORG_ADMIN": "ORG_ADMIN",
    "READ_WRITE": "READ_WRITE",
    "SERVICE_SUPPORT": "SERVICE_SUPPORT",
    "VIEW_ONLY": "VIEW_ONLY",
}


def login_via_rbac(*, email: str, password: str, organization_slug: str | None) -> str:
    settings = get_settings()
    base_url = settings.rbac_api_url.rstrip("/")

    try:
        request_payload: dict[str, Any] = {
            "email": email,
            "password": password,
        }
        if organization_slug:
            request_payload["organizationId"] = organization_slug

        response = httpx.post(
            f"{base_url}/auth/login",
            json=request_payload,
            timeout=5.0,
        )
    except httpx.HTTPError as error:
        raise AppException(
            error_code="AUTH_SERVICE_UNAVAILABLE",
            message="Tenant authentication service is unavailable",
            status_code=503,
        ) from error

    payload = response.json() if response.content else {}
    if not response.is_success or not isinstance(payload, dict) or "token" not in payload:
        raise AppException(
            error_code=str(payload.get("error_code") or "UNAUTHORIZED"),
            message=str(payload.get("message") or payload.get("detail") or "Invalid credentials"),
            status_code=response.status_code or 401,
            details=payload.get("details"),
        )

    return str(payload["token"])


def get_or_create_rbac_shadow_user(db: Session, payload: dict[str, Any]) -> User:
    role_name = RBAC_TO_LOCAL_ROLE.get(str(payload.get("role")))
    if role_name is None:
        raise AppException(
            error_code="FORBIDDEN",
            message="Role is not allowed in ERP",
            status_code=403,
        )

    organization_slug = str(payload.get("organizationId") or "").strip()
    external_user_id = str(payload.get("userId") or "").strip()
    email = str(payload.get("email") or "").strip().lower()

    if not organization_slug or not external_user_id or not email:
        raise AppException(
            error_code="UNAUTHORIZED",
            message="Invalid token",
            status_code=401,
        )

    external_subject = f"rbac:{organization_slug}:{external_user_id}"
    user = get_user_by_external_subject(db, external_subject)

    if user is None:
        email_owner = get_any_user_by_email(db, email)
        if email_owner is not None:
            if email_owner.auth_provider == "LOCAL":
                raise AppException(
                    error_code="CONFLICT",
                    message="A local user already exists with this email",
                    status_code=409,
                )
            user = email_owner
        else:
            user = User(
                email=email,
                full_name=_resolve_full_name(payload),
                hashed_password=get_password_hash(token_urlsafe(24)),
                auth_provider="RBAC",
                external_subject=external_subject,
                organization_slug=organization_slug,
                is_active=True,
                is_superuser=False,
            )
            db.add(user)
            db.flush()

    user.email = email
    user.full_name = _resolve_full_name(payload)
    user.auth_provider = "RBAC"
    user.external_subject = external_subject
    user.organization_slug = organization_slug
    user.is_active = True
    user.is_superuser = False

    roles_by_name = ensure_rbac_seeded(db)
    assign_roles_to_user(db, user, [roles_by_name[role_name].id])
    db.commit()
    refreshed = get_user_by_id(db, user.id)
    if refreshed is None:
        raise AppException(
            error_code="INTERNAL_ERROR",
            message="Failed to sync tenant user",
            status_code=500,
        )
    return refreshed


def _resolve_full_name(payload: dict[str, Any]) -> str:
    full_name = str(payload.get("fullName") or "").strip()
    if full_name:
        return full_name

    email = str(payload.get("email") or "").strip()
    local_part = email.split("@", maxsplit=1)[0]
    return local_part.replace(".", " ").replace("_", " ").title() or "Tenant User"
