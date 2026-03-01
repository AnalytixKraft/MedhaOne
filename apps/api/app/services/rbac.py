from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal, engine
from app.core.security import get_password_hash
from app.models.rbac import Permission, RolePermission, UserRole
from app.models.role import Role
from app.models.user import User

CORE_PERMISSIONS = (
    ("purchase", "create", "purchase:create"),
    ("purchase", "approve", "purchase:approve"),
    ("grn", "create", "grn:create"),
    ("grn", "post", "grn:post"),
    ("inventory", "view", "inventory:view"),
    ("reports", "view", "reports:view"),
    ("user", "manage", "user:manage"),
)

CORE_ROLES = {
    "ADMIN": {
        "description": "Full platform administration access.",
        "is_system": True,
    },
    "ORG_ADMIN": {
        "description": "Tenant administrator bridged from RBAC.",
        "is_system": True,
    },
    "PURCHASE_MANAGER": {
        "description": "Can manage purchase orders and approve receipts.",
        "is_system": True,
    },
    "READ_WRITE": {
        "description": "Can execute operational transactions without approval authority.",
        "is_system": True,
    },
    "SERVICE_SUPPORT": {
        "description": "Read-only support access bridged from RBAC.",
        "is_system": True,
    },
    "STORE_EXECUTIVE": {
        "description": "Can create GRNs and view inventory.",
        "is_system": True,
    },
    "VIEW_ONLY": {
        "description": "Can access read-only reports and stock visibility.",
        "is_system": True,
    },
}

ROLE_PERMISSION_CODES = {
    "ADMIN": {code for _, _, code in CORE_PERMISSIONS},
    "ORG_ADMIN": {
        "purchase:create",
        "purchase:approve",
        "grn:create",
        "grn:post",
        "inventory:view",
        "reports:view",
    },
    "PURCHASE_MANAGER": {
        "purchase:create",
        "purchase:approve",
        "grn:create",
        "grn:post",
        "inventory:view",
        "reports:view",
    },
    "READ_WRITE": {
        "purchase:create",
        "grn:create",
        "grn:post",
        "inventory:view",
        "reports:view",
    },
    "SERVICE_SUPPORT": {
        "inventory:view",
        "reports:view",
    },
    "STORE_EXECUTIVE": {
        "grn:create",
        "grn:post",
        "inventory:view",
        "reports:view",
    },
    "VIEW_ONLY": {
        "inventory:view",
        "reports:view",
    },
}


def ensure_rbac_seeded(db: Session) -> dict[str, Role]:
    permissions_by_code: dict[str, Permission] = {
        permission.code: permission for permission in db.query(Permission).all()
    }

    for module, action, code in CORE_PERMISSIONS:
        permission = permissions_by_code.get(code)
        if permission is None:
            permission = Permission(module=module, action=action, code=code)
            db.add(permission)
            db.flush()
            permissions_by_code[code] = permission

    roles_by_name: dict[str, Role] = {}
    for role_name, role_config in CORE_ROLES.items():
        role = db.query(Role).filter(Role.name == role_name).first()
        if role is None:
            role = Role(
                name=role_name,
                description=role_config["description"],
                is_system=role_config["is_system"],
                is_active=True,
            )
            db.add(role)
            db.flush()
        else:
            updated = False
            if role.description != role_config["description"]:
                role.description = role_config["description"]
                updated = True
            if role.is_system != role_config["is_system"]:
                role.is_system = role_config["is_system"]
                updated = True
            if not role.is_active:
                role.is_active = True
                updated = True
            if updated:
                db.flush()
        roles_by_name[role_name] = role

    for role_name, permission_codes in ROLE_PERMISSION_CODES.items():
        role = roles_by_name[role_name]
        existing_codes = {permission.code for permission in role.permissions}
        for code in permission_codes - existing_codes:
            db.add(
                RolePermission(
                    role_id=role.id,
                    permission_id=permissions_by_code[code].id,
                )
            )

    users_with_primary_role = db.query(User).filter(User.role_id.isnot(None)).all()
    for user in users_with_primary_role:
        if user.role_id is None:
            continue
        has_link = any(link.role_id == user.role_id for link in user.user_roles)
        if not has_link:
            db.add(UserRole(user_id=user.id, role_id=user.role_id))

    db.flush()
    return roles_by_name


def assign_roles_to_user(db: Session, user: User, role_ids: Iterable[int]) -> list[Role]:
    unique_role_ids = list(dict.fromkeys(int(role_id) for role_id in role_ids))
    if not unique_role_ids:
        user.user_roles.clear()
        user.role_id = None
        db.flush()
        return []

    roles = db.query(Role).filter(Role.id.in_(unique_role_ids)).all()
    roles_by_id = {role.id: role for role in roles}

    missing_role_ids = [role_id for role_id in unique_role_ids if role_id not in roles_by_id]
    if missing_role_ids:
        missing = ", ".join(str(role_id) for role_id in missing_role_ids)
        from app.core.exceptions import AppException

        raise AppException(
            error_code="NOT_FOUND",
            message=f"Role not found: {missing}",
            status_code=404,
        )

    current_links = {link.role_id: link for link in user.user_roles}
    for role_id in list(current_links):
        if role_id not in roles_by_id:
            db.delete(current_links[role_id])

    for role_id in unique_role_ids:
        if role_id not in current_links:
            user.user_roles.append(UserRole(role_id=role_id))

    if user.role_id not in roles_by_id:
        user.role_id = unique_role_ids[0]

    db.flush()
    return [roles_by_id[role_id] for role_id in unique_role_ids]


def ensure_admin_user(db: Session) -> User:
    settings = get_settings()
    roles_by_name = ensure_rbac_seeded(db)
    admin_role = roles_by_name["ADMIN"]

    user = db.query(User).filter(User.email == settings.default_admin_email).first()
    if user is None:
        user = User(
            email=settings.default_admin_email,
            full_name="System Administrator",
            hashed_password=get_password_hash(settings.default_admin_password),
            is_active=True,
            is_superuser=True,
            role_id=admin_role.id,
        )
        db.add(user)
        db.flush()

    user.is_active = True
    user.is_superuser = True
    assign_roles_to_user(db, user, [admin_role.id])
    db.commit()
    db.refresh(user)
    return user


def bootstrap_rbac_if_ready() -> None:
    inspector = inspect(engine)
    required_tables = {"users", "roles", "permissions", "user_roles", "role_permissions"}
    if not required_tables.issubset(set(inspector.get_table_names())):
        return
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    required_user_columns = {
        "auth_provider",
        "external_subject",
        "organization_slug",
    }
    if not required_user_columns.issubset(user_columns):
        return

    with SessionLocal() as db:
        ensure_admin_user(db)
