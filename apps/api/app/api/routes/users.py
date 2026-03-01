from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from fastapi import APIRouter, Depends

from app.core.database import get_db
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.core.security import get_password_hash
from app.models.rbac import Permission, RolePermission, UserRole
from app.models.role import Role
from app.models.user import User
from app.schemas.user import (
    UserCreate,
    UserListResponse,
    UserRead,
    UserRoleAssignmentRequest,
    UserRolesResponse,
    UserUpdate,
)
from app.services.rbac import assign_roles_to_user

router = APIRouter()


def _user_query(db: Session):
    return (
        db.query(User)
        .options(
            joinedload(User.role),
            selectinload(User.roles).selectinload(Role.permissions),
        )
        .filter(User.auth_provider == "LOCAL")
    )


def _get_user_or_404(db: Session, user_id: int) -> User:
    user = _user_query(db).filter(User.id == user_id).first()
    if not user:
        raise AppException(
            error_code="NOT_FOUND",
            message="User not found",
            status_code=404,
        )
    return user


def _count_active_user_managers(db: Session) -> int:
    count = (
        db.query(func.count(func.distinct(User.id)))
        .outerjoin(UserRole, UserRole.user_id == User.id)
        .outerjoin(RolePermission, RolePermission.role_id == UserRole.role_id)
        .outerjoin(Permission, Permission.id == RolePermission.permission_id)
        .filter(User.auth_provider == "LOCAL")
        .filter(User.is_active.is_(True))
        .filter((User.is_superuser.is_(True)) | (Permission.code == "user:manage"))
        .scalar()
    )
    return int(count or 0)


@router.get("/", response_model=UserListResponse)
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("user:manage")),
) -> UserListResponse:
    _ = current_user
    users = _user_query(db).order_by(User.created_at.desc(), User.id.desc()).all()
    return UserListResponse(items=users)


@router.post("/", response_model=UserRead, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("user:manage")),
) -> UserRead:
    _ = current_user

    existing_user = db.query(User).filter(User.email == payload.email).first()
    if existing_user:
        raise AppException(
            error_code="CONFLICT",
            message="Email already exists",
            status_code=409,
        )

    user = User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=get_password_hash(payload.password),
        is_active=payload.is_active,
        is_superuser=payload.is_superuser,
    )
    db.add(user)
    db.flush()
    assign_roles_to_user(db, user, payload.role_ids)
    db.commit()
    return _get_user_or_404(db, user.id)


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("user:manage")),
) -> UserRead:
    user = _get_user_or_404(db, user_id)

    if payload.email is not None and payload.email != user.email:
        existing_user = db.query(User).filter(User.email == payload.email).first()
        if existing_user and existing_user.id != user.id:
            raise AppException(
                error_code="CONFLICT",
                message="Email already exists",
                status_code=409,
            )
        user.email = payload.email

    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.password is not None:
        user.hashed_password = get_password_hash(payload.password)
    if payload.is_active is not None:
        if user.id == current_user.id and payload.is_active is False and _count_active_user_managers(db) <= 1:
            raise AppException(
                error_code="FORBIDDEN",
                message="Cannot deactivate the last active administrator",
                status_code=403,
            )
        user.is_active = payload.is_active
    if payload.is_superuser is not None:
        user.is_superuser = payload.is_superuser

    db.commit()
    return _get_user_or_404(db, user.id)


@router.delete("/{user_id}", response_model=UserRead)
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("user:manage")),
) -> UserRead:
    user = _get_user_or_404(db, user_id)

    if user.id == current_user.id and _count_active_user_managers(db) <= 1:
        raise AppException(
            error_code="FORBIDDEN",
            message="Cannot deactivate the last active administrator",
            status_code=403,
        )

    user.is_active = False
    db.commit()
    return _get_user_or_404(db, user.id)


@router.post("/{user_id}/roles", response_model=UserRolesResponse)
def assign_user_roles(
    user_id: int,
    payload: UserRoleAssignmentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("user:manage")),
) -> UserRolesResponse:
    user = _get_user_or_404(db, user_id)

    if user.id == current_user.id and not payload.role_ids and _count_active_user_managers(db) <= 1:
        raise AppException(
            error_code="FORBIDDEN",
            message="Cannot remove access from the last active administrator",
            status_code=403,
        )

    assign_roles_to_user(db, user, payload.role_ids)
    db.commit()
    refreshed = _get_user_or_404(db, user.id)
    return UserRolesResponse(
        user_id=refreshed.id,
        roles=refreshed.effective_roles,
        permissions=refreshed.permissions,
    )


@router.get("/{user_id}/roles", response_model=UserRolesResponse)
def get_user_roles(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("user:manage")),
) -> UserRolesResponse:
    _ = current_user
    user = _get_user_or_404(db, user_id)
    return UserRolesResponse(
        user_id=user.id,
        roles=user.effective_roles,
        permissions=user.permissions,
    )
