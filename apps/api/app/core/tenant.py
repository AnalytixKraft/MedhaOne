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
from app.models.role import Role
from app.models.user import User
from app.services.rbac import assign_roles_to_user, ensure_rbac_seeded

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
    payload: dict = Depends(get_token_payload),
    tenant_schema: str | None = Depends(resolve_request_tenant_schema),
) -> None:
    if tenant_schema is None:
        return

    local_user = _get_local_user_snapshot(db, payload)
    set_tenant_search_path(db, tenant_schema)
    _ensure_runtime_schema_compatibility(db, tenant_schema)
    _assert_tenant_search_path(db, tenant_schema)
    if local_user is not None:
        _ensure_local_user_record_in_tenant_schema(db, local_user)


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


def _get_local_user_snapshot(db: Session, payload: dict) -> dict | None:
    user = _get_local_user_from_payload(db, payload)
    if user is None:
        return None

    roles: list[dict[str, object]] = []
    seen_role_names: set[str] = set()
    for role in user.effective_roles:
        role_name = getattr(role, "name", None)
        if not isinstance(role_name, str) or not role_name or role_name in seen_role_names:
            continue
        roles.append(
            {
                "name": role_name,
                "description": role.description,
                "is_system": role.is_system,
                "is_active": role.is_active,
            }
        )
        seen_role_names.add(role_name)

    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "hashed_password": user.hashed_password,
        "auth_provider": user.auth_provider,
        "external_subject": user.external_subject,
        "organization_slug": user.organization_slug,
        "is_active": user.is_active,
        "is_superuser": user.is_superuser,
        "last_login_at": user.last_login_at,
        "primary_role_name": user.role.name if user.role is not None else None,
        "roles": roles,
    }


def _ensure_local_user_record_in_tenant_schema(db: Session, source_user: dict) -> None:
    tenant_schema = str(db.info.get("tenant_schema") or "")
    if tenant_schema and _is_legacy_tenant_users_table(db, tenant_schema):
        _upsert_legacy_tenant_user(db, source_user)
        return

    desired_roles = _ensure_tenant_roles(db, source_user.get("roles"))
    desired_role_ids = [role.id for role in desired_roles]
    desired_primary_role_id = _resolve_primary_tenant_role_id(
        desired_roles,
        source_user.get("primary_role_name"),
    )

    tenant_user = db.get(User, int(source_user["id"]))
    if tenant_user is None:
        tenant_user = User(
            id=int(source_user["id"]),
            email=str(source_user["email"]),
            full_name=str(source_user["full_name"]),
            hashed_password=str(source_user["hashed_password"]),
            auth_provider=str(source_user["auth_provider"]),
            external_subject=source_user["external_subject"],
            organization_slug=source_user["organization_slug"],
            is_active=bool(source_user["is_active"]),
            is_superuser=bool(source_user["is_superuser"]),
            role_id=desired_primary_role_id,
            last_login_at=source_user["last_login_at"],
        )
        db.add(tenant_user)
        db.flush()
        if desired_role_ids:
            assign_roles_to_user(db, tenant_user, desired_role_ids)
            if desired_primary_role_id is not None and tenant_user.role_id != desired_primary_role_id:
                tenant_user.role_id = desired_primary_role_id
                db.flush()
        if IS_POSTGRES:
            db.execute(
                text(
                    """
                    SELECT setval(
                        pg_get_serial_sequence('users', 'id'),
                        GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1),
                        true
                    )
                    """
                )
            )
        return

    tenant_user.email = str(source_user["email"])
    tenant_user.full_name = str(source_user["full_name"])
    tenant_user.hashed_password = str(source_user["hashed_password"])
    tenant_user.auth_provider = str(source_user["auth_provider"])
    tenant_user.external_subject = source_user["external_subject"]
    tenant_user.organization_slug = source_user["organization_slug"]
    tenant_user.is_active = bool(source_user["is_active"])
    tenant_user.is_superuser = bool(source_user["is_superuser"])
    tenant_user.last_login_at = source_user["last_login_at"]
    if desired_role_ids:
        assign_roles_to_user(db, tenant_user, desired_role_ids)
    else:
        tenant_user.user_roles.clear()
        tenant_user.role_id = None
    if desired_primary_role_id is not None:
        tenant_user.role_id = desired_primary_role_id
    db.flush()


def _is_legacy_tenant_users_table(db: Session, schema_name: str) -> bool:
    if not _table_exists(db, schema_name, "users"):
        return False

    columns = {
        str(row["column_name"]): str(row["data_type"])
        for row in db.execute(
            text(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'users'
                """
            ),
            {"schema_name": schema_name},
        ).mappings()
    }

    # Legacy tenant users table shape:
    # id(text), password_hash(text), role(text) and no role_id/auth_provider columns.
    required_legacy_columns = {
        "id",
        "email",
        "password_hash",
        "full_name",
        "role",
        "is_active",
        "last_login_at",
    }
    if not required_legacy_columns.issubset(columns):
        return False

    if "hashed_password" in columns or "role_id" in columns:
        return False

    return columns.get("id") in {"text", "character varying"}


def _upsert_legacy_tenant_user(db: Session, source_user: dict) -> None:
    params = {
        "id": str(source_user["id"]),
        "email": str(source_user["email"]),
        "password_hash": str(source_user["hashed_password"]),
        "full_name": str(source_user["full_name"]),
        "role": str(source_user.get("primary_role_name") or "ORG_ADMIN"),
        "is_active": bool(source_user["is_active"]),
        "last_login_at": source_user["last_login_at"],
    }
    updated = db.execute(
        text(
            """
            UPDATE users
            SET
                id = :id,
                email = :email,
                password_hash = :password_hash,
                full_name = :full_name,
                role = :role,
                is_active = :is_active,
                last_login_at = :last_login_at,
                updated_at = NOW()
            WHERE id = :id OR email = :email
            """
        ),
        params,
    ).rowcount

    if not updated:
        db.execute(
            text(
                """
                INSERT INTO users (
                    id,
                    email,
                    password_hash,
                    full_name,
                    role,
                    is_active,
                    last_login_at,
                    created_at,
                    updated_at
                )
                VALUES (
                    :id,
                    :email,
                    :password_hash,
                    :full_name,
                    :role,
                    :is_active,
                    :last_login_at,
                    NOW(),
                    NOW()
                )
                """
            ),
            params,
        )


def _ensure_tenant_roles(db: Session, raw_roles: object) -> list[Role]:
    roles_by_name = ensure_rbac_seeded(db)
    desired_roles: list[Role] = []

    if not isinstance(raw_roles, list):
        return desired_roles

    for raw_role in raw_roles:
        if not isinstance(raw_role, dict):
            continue
        role_name = raw_role.get("name")
        if not isinstance(role_name, str) or not role_name:
            continue

        role = roles_by_name.get(role_name)
        if role is None:
            role = Role(
                name=role_name,
                description=(
                    str(raw_role.get("description"))
                    if raw_role.get("description") is not None
                    else None
                ),
                is_system=bool(raw_role.get("is_system", False)),
                is_active=bool(raw_role.get("is_active", True)),
            )
            db.add(role)
            db.flush()
            roles_by_name[role_name] = role
        desired_roles.append(role)

    return desired_roles


def _resolve_primary_tenant_role_id(
    roles: list[Role],
    primary_role_name: object,
) -> int | None:
    if isinstance(primary_role_name, str):
        for role in roles:
            if role.name == primary_role_name:
                return int(role.id)
    if roles:
        return int(roles[0].id)
    return None


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

    users_table_exists = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = :schema_name
              AND table_name = 'users'
            """
        ),
        {"schema_name": schema_name},
    ).scalar_one_or_none()

    if users_table_exists is not None:
        theme_preference_exists = db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'users'
                  AND column_name = 'theme_preference'
                """
            ),
            {"schema_name": schema_name},
        ).scalar_one_or_none()

        if theme_preference_exists is None:
            db.execute(
                text(
                    f"""
                    ALTER TABLE {_build_quoted_schema_table(schema_name, "users")}
                    ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(16)
                    NOT NULL DEFAULT 'system'
                    """
                )
            )
            db.commit()
            logger.warning(
                "Auto-repaired schema to add missing users.theme_preference",
                extra={"schema": schema_name},
            )

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
        if schema_name == "public":
            _SCHEMA_COMPATIBILITY_CHECKED.add(schema_name)
        return

    categories_table_exists = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = :schema_name
              AND table_name = 'categories'
            """
        ),
        {"schema_name": schema_name},
    ).scalar_one_or_none()

    if categories_table_exists is None:
        db.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {_build_quoted_schema_table(schema_name, "categories")} (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(120) NOT NULL UNIQUE,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        )
        db.commit()
        logger.warning(
            "Auto-repaired tenant schema to add missing categories table",
            extra={"schema": schema_name},
        )

    brands_table_exists = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = :schema_name
              AND table_name = 'brands'
            """
        ),
        {"schema_name": schema_name},
    ).scalar_one_or_none()

    if brands_table_exists is None:
        db.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {_build_quoted_schema_table(schema_name, "brands")} (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(120) NOT NULL UNIQUE,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        )
        db.commit()
        logger.warning(
            "Auto-repaired tenant schema to add missing brands table",
            extra={"schema": schema_name},
        )

    _auto_repair_inventory_tables(db, schema_name)
    _auto_repair_purchase_tables(db, schema_name)
    _auto_repair_purchase_bill_tables(db, schema_name)

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

        _auto_repair_party_master_columns(db, schema_name)

    # Compatibility repairs may commit DDL, and pooled checkouts default back to public.
    # Rebind the tenant schema before the request continues.
    if schema_name != "public":
        set_tenant_search_path(db, schema_name)

    _SCHEMA_COMPATIBILITY_CHECKED.add(schema_name)


def _table_exists(db: Session, schema_name: str, table_name: str) -> bool:
    return (
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = :schema_name
                  AND table_name = :table_name
                """
            ),
            {"schema_name": schema_name, "table_name": table_name},
        ).scalar_one_or_none()
        is not None
    )


def _index_exists(db: Session, schema_name: str, index_name: str) -> bool:
    return (
        db.execute(
            text(
                """
                SELECT 1
                FROM pg_indexes
                WHERE schemaname = :schema_name
                  AND indexname = :index_name
                """
            ),
            {"schema_name": schema_name, "index_name": index_name},
        ).scalar_one_or_none()
        is not None
    )


def _auto_repair_inventory_tables(db: Session, schema_name: str) -> None:
    # Some legacy tenant schemas were provisioned partially. Repair missing
    # inventory tables in-place to keep stock reports operational.
    required_parent_tables = ("users", "products", "warehouses")
    if not all(_table_exists(db, schema_name, table_name) for table_name in required_parent_tables):
        return

    batches_table = _build_quoted_schema_table(schema_name, "batches")
    products_table = _build_quoted_schema_table(schema_name, "products")
    users_table = _build_quoted_schema_table(schema_name, "users")
    warehouses_table = _build_quoted_schema_table(schema_name, "warehouses")
    ledger_table = _build_quoted_schema_table(schema_name, "inventory_ledger")
    stock_summary_table = _build_quoted_schema_table(schema_name, "stock_summary")
    users_id_data_type = (
        db.execute(
            text(
                """
                SELECT data_type
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'users'
                  AND column_name = 'id'
                """
            ),
            {"schema_name": schema_name},
        ).scalar_one_or_none()
        or ""
    )
    users_id_type = "INTEGER" if users_id_data_type in {"integer", "smallint", "bigint"} else "TEXT"
    created_by_column_sql = (
        f"created_by {users_id_type} NOT NULL REFERENCES {users_table}(id),"
        if users_id_type == "INTEGER"
        else f"created_by {users_id_type} NOT NULL,"
    )

    did_repair = False
    did_ddl = False

    if not _table_exists(db, schema_name, "batches"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {batches_table} (
                    id SERIAL PRIMARY KEY,
                    product_id INTEGER NOT NULL REFERENCES {products_table}(id),
                    batch_no VARCHAR(100) NOT NULL,
                    expiry_date DATE NOT NULL,
                    mfg_date DATE NULL,
                    mrp NUMERIC(12, 2) NULL,
                    CONSTRAINT uq_batch_product_no_expiry
                        UNIQUE (product_id, batch_no, expiry_date)
                )
                """
            )
        )
        did_repair = True

    if not _index_exists(db, schema_name, "ix_batches_product_id"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE INDEX IF NOT EXISTS ix_batches_product_id
                ON {batches_table} (product_id)
                """
            )
        )
    if not _index_exists(db, schema_name, "ix_batches_expiry_date"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE INDEX IF NOT EXISTS ix_batches_expiry_date
                ON {batches_table} (expiry_date)
                """
            )
        )
    if not _index_exists(db, schema_name, "ix_batches_batch_no"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE INDEX IF NOT EXISTS ix_batches_batch_no
                ON {batches_table} (batch_no)
                """
            )
        )
    reference_id_exists = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = :schema_name
              AND table_name = 'batches'
              AND column_name = 'reference_id'
            """
        ),
        {"schema_name": schema_name},
    ).scalar_one_or_none()
    if reference_id_exists is None:
        did_ddl = True
        db.execute(
            text(
                f"""
                ALTER TABLE {batches_table}
                ADD COLUMN IF NOT EXISTS reference_id VARCHAR(120)
                """
            )
        )
        did_repair = True

    if not _table_exists(db, schema_name, "inventory_ledger"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {ledger_table} (
                    id SERIAL PRIMARY KEY,
                    txn_type inventory_txn_type_enum NOT NULL,
                    reason inventory_reason_enum NOT NULL,
                    ref_type VARCHAR(50) NULL,
                    ref_id VARCHAR(100) NULL,
                    warehouse_id INTEGER NOT NULL REFERENCES {warehouses_table}(id),
                    product_id INTEGER NOT NULL REFERENCES {products_table}(id),
                    batch_id INTEGER NOT NULL REFERENCES {batches_table}(id),
                    qty NUMERIC(18, 3) NOT NULL,
                    unit_cost NUMERIC(14, 4) NULL,
                    {created_by_column_sql}
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        )
        did_repair = True

    if not _index_exists(db, schema_name, "ix_inventory_ledger_batch_id"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE INDEX IF NOT EXISTS ix_inventory_ledger_batch_id
                ON {ledger_table} (batch_id)
                """
            )
        )
    if not _index_exists(db, schema_name, "ix_inventory_ledger_created_at"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE INDEX IF NOT EXISTS ix_inventory_ledger_created_at
                ON {ledger_table} (created_at)
                """
            )
        )
    if not _index_exists(db, schema_name, "ix_inventory_ledger_wh_prod"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE INDEX IF NOT EXISTS ix_inventory_ledger_wh_prod
                ON {ledger_table} (warehouse_id, product_id)
                """
            )
        )
    if not _index_exists(db, schema_name, "ix_inventory_ledger_reason"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE INDEX IF NOT EXISTS ix_inventory_ledger_reason
                ON {ledger_table} (reason)
                """
            )
        )

    if not _table_exists(db, schema_name, "stock_summary"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {stock_summary_table} (
                    id SERIAL PRIMARY KEY,
                    warehouse_id INTEGER NOT NULL REFERENCES {warehouses_table}(id),
                    product_id INTEGER NOT NULL REFERENCES {products_table}(id),
                    batch_id INTEGER NOT NULL REFERENCES {batches_table}(id),
                    qty_on_hand NUMERIC(18, 3) NOT NULL DEFAULT 0,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT uq_stock_summary_wh_product_batch
                        UNIQUE (warehouse_id, product_id, batch_id)
                )
                """
            )
        )
        did_repair = True

    if not _index_exists(db, schema_name, "ix_stock_summary_wh_prod_qty"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE INDEX IF NOT EXISTS ix_stock_summary_wh_prod_qty
                ON {stock_summary_table} (warehouse_id, product_id, qty_on_hand)
                """
            )
        )

    if did_ddl:
        db.commit()

    if did_repair:
        logger.warning(
            "Auto-repaired tenant schema to create missing inventory tables",
            extra={"schema": schema_name},
        )


def _auto_repair_purchase_tables(db: Session, schema_name: str) -> None:
    required_parent_tables = ("users", "products", "warehouses", "parties")
    if not all(_table_exists(db, schema_name, table_name) for table_name in required_parent_tables):
        return

    users_table = _build_quoted_schema_table(schema_name, "users")
    products_table = _build_quoted_schema_table(schema_name, "products")
    warehouses_table = _build_quoted_schema_table(schema_name, "warehouses")
    parties_table = _build_quoted_schema_table(schema_name, "parties")
    po_table = _build_quoted_schema_table(schema_name, "purchase_orders")
    po_lines_table = _build_quoted_schema_table(schema_name, "purchase_order_lines")
    grn_table = _build_quoted_schema_table(schema_name, "grns")
    grn_lines_table = _build_quoted_schema_table(schema_name, "grn_lines")
    grn_batch_lines_table = _build_quoted_schema_table(schema_name, "grn_batch_lines")
    stock_source_provenance_table = _build_quoted_schema_table(schema_name, "stock_source_provenance")
    inventory_ledger_table = _build_quoted_schema_table(schema_name, "inventory_ledger")
    batches_table = _build_quoted_schema_table(schema_name, "batches")
    purchase_bills_table = _build_quoted_schema_table(schema_name, "purchase_bills")
    purchase_bill_lines_table = _build_quoted_schema_table(schema_name, "purchase_bill_lines")
    users_id_data_type = (
        db.execute(
            text(
                """
                SELECT data_type
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'users'
                  AND column_name = 'id'
                """
            ),
            {"schema_name": schema_name},
        ).scalar_one_or_none()
        or ""
    )
    users_id_type = "INTEGER" if users_id_data_type in {"integer", "smallint", "bigint"} else "TEXT"
    created_by_column_sql = (
        f"created_by {users_id_type} NOT NULL REFERENCES {users_table}(id),"
        if users_id_type == "INTEGER"
        else f"created_by {users_id_type} NOT NULL,"
    )

    did_repair = False
    did_ddl = False

    if not _table_exists(db, schema_name, "purchase_orders"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {po_table} (
                    id SERIAL PRIMARY KEY,
                    po_number VARCHAR(60) NOT NULL UNIQUE,
                    supplier_id INTEGER NOT NULL REFERENCES {parties_table}(id),
                    warehouse_id INTEGER NOT NULL REFERENCES {warehouses_table}(id),
                    status purchase_order_status_enum NOT NULL DEFAULT 'DRAFT',
                    order_date DATE NOT NULL,
                    expected_date DATE NULL,
                    notes TEXT NULL,
                    tax_type VARCHAR(20) NULL,
                    subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
                    discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    taxable_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    gst_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
                    cgst_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
                    sgst_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
                    igst_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
                    cgst_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    sgst_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    igst_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    adjustment NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    final_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    {created_by_column_sql}
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        )
        did_repair = True

    purchase_order_columns = {
        "tax_type": "VARCHAR(20)",
        "subtotal": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "discount_percent": "NUMERIC(5, 2) NOT NULL DEFAULT 0",
        "discount_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "taxable_value": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "gst_percent": "NUMERIC(5, 2) NOT NULL DEFAULT 0",
        "cgst_percent": "NUMERIC(5, 2) NOT NULL DEFAULT 0",
        "sgst_percent": "NUMERIC(5, 2) NOT NULL DEFAULT 0",
        "igst_percent": "NUMERIC(5, 2) NOT NULL DEFAULT 0",
        "cgst_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "sgst_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "igst_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "adjustment": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "final_total": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
    }
    for column_name, column_sql in purchase_order_columns.items():
        exists = db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'purchase_orders'
                  AND column_name = :column_name
                """
            ),
            {"schema_name": schema_name, "column_name": column_name},
        ).scalar_one_or_none()
        if exists is None:
            did_ddl = True
            db.execute(
                text(
                    f"""
                    ALTER TABLE {po_table}
                    ADD COLUMN IF NOT EXISTS {column_name} {column_sql}
                    """
                )
            )
            did_repair = True

    if not _table_exists(db, schema_name, "purchase_order_lines"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {po_lines_table} (
                    id SERIAL PRIMARY KEY,
                    purchase_order_id INTEGER NOT NULL REFERENCES {po_table}(id),
                    product_id INTEGER NOT NULL REFERENCES {products_table}(id),
                    ordered_qty NUMERIC(18, 3) NOT NULL,
                    received_qty NUMERIC(18, 3) NOT NULL DEFAULT 0,
                    unit_cost NUMERIC(14, 4) NULL,
                    free_qty NUMERIC(18, 3) NOT NULL DEFAULT 0,
                    discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    taxable_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    gst_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
                    cgst_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
                    sgst_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
                    igst_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
                    cgst_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    sgst_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    igst_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    line_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    line_notes TEXT NULL
                )
                """
            )
        )
        did_repair = True

    purchase_order_line_columns = {
        "discount_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "taxable_value": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "gst_percent": "NUMERIC(5, 2) NOT NULL DEFAULT 0",
        "cgst_percent": "NUMERIC(5, 2) NOT NULL DEFAULT 0",
        "sgst_percent": "NUMERIC(5, 2) NOT NULL DEFAULT 0",
        "igst_percent": "NUMERIC(5, 2) NOT NULL DEFAULT 0",
        "cgst_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "sgst_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "igst_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "tax_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "line_total": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
    }
    for column_name, column_sql in purchase_order_line_columns.items():
        exists = db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'purchase_order_lines'
                  AND column_name = :column_name
                """
            ),
            {"schema_name": schema_name, "column_name": column_name},
        ).scalar_one_or_none()
        if exists is None:
            did_ddl = True
            db.execute(
                text(
                    f"""
                    ALTER TABLE {po_lines_table}
                    ADD COLUMN IF NOT EXISTS {column_name} {column_sql}
                    """
                )
            )
            did_repair = True

    if all(_table_exists(db, schema_name, table_name) for table_name in ("batches",)):
        purchase_bill_fk_sql = (
            f"INTEGER NULL REFERENCES {purchase_bills_table}(id)"
            if _table_exists(db, schema_name, "purchase_bills")
            else "INTEGER NULL"
        )
        purchase_bill_line_fk_sql = (
            f"INTEGER NULL REFERENCES {purchase_bill_lines_table}(id)"
            if _table_exists(db, schema_name, "purchase_bill_lines")
            else "INTEGER NULL"
        )
        if not _table_exists(db, schema_name, "grns"):
            did_ddl = True
            db.execute(
                text(
                    f"""
                    CREATE TABLE IF NOT EXISTS {grn_table} (
                        id SERIAL PRIMARY KEY,
                        grn_number VARCHAR(60) NOT NULL UNIQUE,
                        purchase_order_id INTEGER NOT NULL REFERENCES {po_table}(id),
                        purchase_bill_id {purchase_bill_fk_sql},
                        supplier_id INTEGER NOT NULL REFERENCES {parties_table}(id),
                        warehouse_id INTEGER NOT NULL REFERENCES {warehouses_table}(id),
                        status grn_status_enum NOT NULL DEFAULT 'DRAFT',
                        received_date DATE NOT NULL,
                        remarks TEXT NULL,
                        posted_at TIMESTAMPTZ NULL,
                        posted_by {users_id_type} NULL,
                        {created_by_column_sql}
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
            did_repair = True

        grn_columns = {
            "purchase_bill_id": purchase_bill_fk_sql,
            "remarks": "TEXT NULL",
            "posted_at": "TIMESTAMPTZ NULL",
            "posted_by": f"{users_id_type} NULL",
            "created_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
            "updated_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
        }
        for column_name, column_sql in grn_columns.items():
            exists = db.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = :schema_name
                      AND table_name = 'grns'
                      AND column_name = :column_name
                    """
                ),
                {"schema_name": schema_name, "column_name": column_name},
            ).scalar_one_or_none()
            if exists is None:
                did_ddl = True
                db.execute(
                    text(
                        f"""
                        ALTER TABLE {grn_table}
                        ADD COLUMN IF NOT EXISTS {column_name} {column_sql}
                        """
                    )
                )
                did_repair = True

        if not _table_exists(db, schema_name, "grn_lines"):
            did_ddl = True
            db.execute(
                text(
                    f"""
                    CREATE TABLE IF NOT EXISTS {grn_lines_table} (
                        id SERIAL PRIMARY KEY,
                        grn_id INTEGER NOT NULL REFERENCES {grn_table}(id),
                        po_line_id INTEGER NULL REFERENCES {po_lines_table}(id),
                        purchase_bill_line_id {purchase_bill_line_fk_sql},
                        product_id INTEGER NOT NULL REFERENCES {products_table}(id),
                        product_name_snapshot VARCHAR(255) NULL,
                        ordered_qty_snapshot NUMERIC(18, 3) NULL,
                        billed_qty_snapshot NUMERIC(18, 3) NULL,
                        received_qty_total NUMERIC(18, 3) NOT NULL DEFAULT 0,
                        free_qty_total NUMERIC(18, 3) NOT NULL DEFAULT 0,
                        batch_id INTEGER NULL REFERENCES {batches_table}(id),
                        received_qty NUMERIC(18, 3) NOT NULL,
                        free_qty NUMERIC(18, 3) NOT NULL DEFAULT 0,
                        unit_cost NUMERIC(14, 4) NULL,
                        expiry_date DATE NULL,
                        remarks TEXT NULL
                    )
                    """
                )
            )
            did_repair = True

        grn_line_columns = {
            "purchase_bill_line_id": purchase_bill_line_fk_sql,
            "product_name_snapshot": "VARCHAR(255) NULL",
            "ordered_qty_snapshot": "NUMERIC(18, 3) NULL",
            "billed_qty_snapshot": "NUMERIC(18, 3) NULL",
            "received_qty_total": "NUMERIC(18, 3) NOT NULL DEFAULT 0",
            "free_qty_total": "NUMERIC(18, 3) NOT NULL DEFAULT 0",
            "remarks": "TEXT NULL",
        }
        for column_name, column_sql in grn_line_columns.items():
            exists = db.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = :schema_name
                      AND table_name = 'grn_lines'
                      AND column_name = :column_name
                    """
                ),
                {"schema_name": schema_name, "column_name": column_name},
            ).scalar_one_or_none()
            if exists is None:
                did_ddl = True
                db.execute(
                    text(
                        f"""
                        ALTER TABLE {grn_lines_table}
                        ADD COLUMN IF NOT EXISTS {column_name} {column_sql}
                        """
                    )
                )
                did_repair = True

        for nullable_column in ("po_line_id", "batch_id", "expiry_date"):
            did_ddl = True
            db.execute(
                text(
                    f"""
                    ALTER TABLE {grn_lines_table}
                    ALTER COLUMN {nullable_column} DROP NOT NULL
                    """
                )
            )

        if not _table_exists(db, schema_name, "grn_batch_lines"):
            did_ddl = True
            db.execute(
                text(
                    f"""
                    CREATE TABLE IF NOT EXISTS {grn_batch_lines_table} (
                        id SERIAL PRIMARY KEY,
                        grn_line_id INTEGER NOT NULL REFERENCES {grn_lines_table}(id),
                        batch_no VARCHAR(80) NOT NULL,
                        expiry_date DATE NOT NULL,
                        mfg_date DATE NULL,
                        mrp NUMERIC(14, 2) NULL,
                        received_qty NUMERIC(18, 3) NOT NULL,
                        free_qty NUMERIC(18, 3) NOT NULL DEFAULT 0,
                        unit_cost NUMERIC(14, 4) NULL,
                        batch_id INTEGER NULL REFERENCES {batches_table}(id),
                        remarks TEXT NULL
                    )
                    """
                )
            )
            did_repair = True

        if _table_exists(db, schema_name, "inventory_ledger"):
            provenance_purchase_bill_fk_sql = (
                f"INTEGER NULL REFERENCES {purchase_bills_table}(id)"
                if _table_exists(db, schema_name, "purchase_bills")
                else "INTEGER NULL"
            )
            if not _table_exists(db, schema_name, "stock_source_provenance"):
                did_ddl = True
                db.execute(
                    text(
                        f"""
                        CREATE TABLE IF NOT EXISTS {stock_source_provenance_table} (
                            id SERIAL PRIMARY KEY,
                            ledger_id INTEGER NOT NULL REFERENCES {inventory_ledger_table}(id),
                            supplier_id INTEGER NOT NULL REFERENCES {parties_table}(id),
                            purchase_order_id INTEGER NOT NULL REFERENCES {po_table}(id),
                            purchase_bill_id {provenance_purchase_bill_fk_sql},
                            grn_id INTEGER NOT NULL REFERENCES {grn_table}(id),
                            grn_line_id INTEGER NOT NULL REFERENCES {grn_lines_table}(id),
                            grn_batch_line_id INTEGER NOT NULL REFERENCES {grn_batch_lines_table}(id),
                            warehouse_id INTEGER NOT NULL REFERENCES {warehouses_table}(id),
                            product_id INTEGER NOT NULL REFERENCES {products_table}(id),
                            batch_id INTEGER NOT NULL REFERENCES {batches_table}(id),
                            batch_no VARCHAR(100) NOT NULL,
                            expiry_date DATE NOT NULL,
                            inward_date DATE NOT NULL,
                            received_qty NUMERIC(18, 3) NOT NULL,
                            free_qty NUMERIC(18, 3) NOT NULL DEFAULT 0,
                            unit_cost_snapshot NUMERIC(14, 4) NULL,
                            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            CONSTRAINT uq_stock_source_provenance_ledger_id UNIQUE (ledger_id)
                        )
                        """
                    )
                )
                did_repair = True

    for sql in [
        f"CREATE INDEX IF NOT EXISTS ix_purchase_orders_supplier_id ON {po_table} (supplier_id)",
        f"CREATE INDEX IF NOT EXISTS ix_purchase_orders_warehouse_id ON {po_table} (warehouse_id)",
        f"CREATE INDEX IF NOT EXISTS ix_purchase_orders_status ON {po_table} (status)",
        f"CREATE INDEX IF NOT EXISTS ix_purchase_orders_order_date ON {po_table} (order_date)",
        f"CREATE INDEX IF NOT EXISTS ix_purchase_order_lines_purchase_order_id ON {po_lines_table} (purchase_order_id)",
        f"CREATE INDEX IF NOT EXISTS ix_grns_purchase_order_id ON {grn_table} (purchase_order_id)",
        f"CREATE INDEX IF NOT EXISTS ix_grns_supplier_id ON {grn_table} (supplier_id)",
        f"CREATE INDEX IF NOT EXISTS ix_grns_warehouse_id ON {grn_table} (warehouse_id)",
        f"CREATE INDEX IF NOT EXISTS ix_grns_status ON {grn_table} (status)",
        f"CREATE INDEX IF NOT EXISTS ix_grns_posted_at ON {grn_table} (posted_at)",
        f"CREATE INDEX IF NOT EXISTS ix_grn_batch_lines_grn_line_id ON {grn_batch_lines_table} (grn_line_id)",
        f"CREATE INDEX IF NOT EXISTS ix_stock_source_provenance_supplier_id ON {stock_source_provenance_table} (supplier_id)",
        f"CREATE INDEX IF NOT EXISTS ix_stock_source_provenance_purchase_order_id ON {stock_source_provenance_table} (purchase_order_id)",
        f"CREATE INDEX IF NOT EXISTS ix_stock_source_provenance_purchase_bill_id ON {stock_source_provenance_table} (purchase_bill_id)",
        f"CREATE INDEX IF NOT EXISTS ix_stock_source_provenance_grn_id ON {stock_source_provenance_table} (grn_id)",
        f"CREATE INDEX IF NOT EXISTS ix_stock_source_provenance_bucket ON {stock_source_provenance_table} (warehouse_id, product_id, batch_id)",
    ]:
        did_ddl = True
        db.execute(text(sql))

    if did_ddl:
        db.commit()

    if did_repair:
        logger.warning(
            "Auto-repaired tenant schema to create missing purchase tables",
            extra={"schema": schema_name},
        )


def _auto_repair_purchase_bill_tables(db: Session, schema_name: str) -> None:
    required_parent_tables = ("users", "products", "warehouses", "parties")
    if not all(_table_exists(db, schema_name, table_name) for table_name in required_parent_tables):
        return

    users_table = _build_quoted_schema_table(schema_name, "users")
    products_table = _build_quoted_schema_table(schema_name, "products")
    warehouses_table = _build_quoted_schema_table(schema_name, "warehouses")
    parties_table = _build_quoted_schema_table(schema_name, "parties")
    attachments_table = _build_quoted_schema_table(schema_name, "document_attachments")
    purchase_bills_table = _build_quoted_schema_table(schema_name, "purchase_bills")
    purchase_bill_lines_table = _build_quoted_schema_table(schema_name, "purchase_bill_lines")
    purchase_orders_table = _build_quoted_schema_table(schema_name, "purchase_orders")
    grns_table = _build_quoted_schema_table(schema_name, "grns")

    users_id_data_type = (
        db.execute(
            text(
                """
                SELECT data_type
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'users'
                  AND column_name = 'id'
                """
            ),
            {"schema_name": schema_name},
        ).scalar_one_or_none()
        or ""
    )
    users_id_type = "INTEGER" if users_id_data_type in {"integer", "smallint", "bigint"} else "TEXT"
    uploaded_by_column_sql = (
        f"uploaded_by {users_id_type} NOT NULL REFERENCES {users_table}(id),"
        if users_id_type == "INTEGER"
        else f"uploaded_by {users_id_type} NOT NULL,"
    )
    created_by_column_sql = (
        f"created_by {users_id_type} NOT NULL REFERENCES {users_table}(id),"
        if users_id_type == "INTEGER"
        else f"created_by {users_id_type} NOT NULL,"
    )
    purchase_order_fk_sql = (
        f"REFERENCES {purchase_orders_table}(id)"
        if _table_exists(db, schema_name, "purchase_orders")
        else ""
    )
    grn_fk_sql = f"REFERENCES {grns_table}(id)" if _table_exists(db, schema_name, "grns") else ""

    did_repair = False
    did_ddl = False

    if db.bind is not None and db.bind.dialect.name == "postgresql":
        did_ddl = True
        db.execute(
            text(
                f"""
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1
                    FROM pg_type t
                    JOIN pg_namespace n ON n.oid = t.typnamespace
                    WHERE t.typname = 'purchase_bill_status_enum'
                      AND n.nspname = '{schema_name}'
                  ) THEN
                    EXECUTE 'CREATE TYPE {quote_schema_name(schema_name)}.purchase_bill_status_enum AS ENUM (
                      ''DRAFT'',
                      ''VERIFIED'',
                      ''POSTED'',
                      ''CANCELLED''
                    )';
                  END IF;
                END $$;
                """
            )
        )
        did_ddl = True
        db.execute(
            text(
                f"""
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1
                    FROM pg_type t
                    JOIN pg_namespace n ON n.oid = t.typnamespace
                    WHERE t.typname = 'purchase_bill_extraction_status_enum'
                      AND n.nspname = '{schema_name}'
                  ) THEN
                    EXECUTE 'CREATE TYPE {quote_schema_name(schema_name)}.purchase_bill_extraction_status_enum AS ENUM (
                      ''NOT_STARTED'',
                      ''EXTRACTED'',
                      ''REVIEWED'',
                      ''FAILED''
                    )';
                  END IF;
                END $$;
                """
            )
        )

    if not _table_exists(db, schema_name, "document_attachments"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {attachments_table} (
                    id SERIAL PRIMARY KEY,
                    entity_type VARCHAR(50) NOT NULL,
                    entity_id INTEGER NOT NULL,
                    file_name VARCHAR(255) NOT NULL,
                    file_type VARCHAR(100) NOT NULL,
                    storage_path TEXT NOT NULL,
                    {uploaded_by_column_sql}
                    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        )
        did_repair = True

    if not _table_exists(db, schema_name, "purchase_bills"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {purchase_bills_table} (
                    id SERIAL PRIMARY KEY,
                    bill_number VARCHAR(120) NOT NULL,
                    supplier_id INTEGER NULL REFERENCES {parties_table}(id),
                    supplier_name_raw VARCHAR(255) NULL,
                    supplier_gstin VARCHAR(20) NULL,
                    bill_date DATE NULL,
                    due_date DATE NULL,
                    warehouse_id INTEGER NULL REFERENCES {warehouses_table}(id),
                    status purchase_bill_status_enum NOT NULL DEFAULT 'DRAFT',
                    subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    taxable_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    cgst_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    sgst_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    igst_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    adjustment NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    total NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    extraction_status purchase_bill_extraction_status_enum NOT NULL DEFAULT 'NOT_STARTED',
                    extraction_confidence NUMERIC(5, 2) NULL,
                    attachment_id INTEGER NULL REFERENCES {attachments_table}(id),
                    purchase_order_id INTEGER NULL {purchase_order_fk_sql},
                    grn_id INTEGER NULL {grn_fk_sql},
                    extracted_json JSON NULL,
                    {created_by_column_sql}
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    remarks TEXT NULL
                )
                """
            )
        )
        did_repair = True

    purchase_bill_columns = {
        "supplier_id": f"INTEGER NULL REFERENCES {parties_table}(id)",
        "supplier_name_raw": "VARCHAR(255)",
        "supplier_gstin": "VARCHAR(20)",
        "bill_date": "DATE",
        "due_date": "DATE",
        "warehouse_id": f"INTEGER NULL REFERENCES {warehouses_table}(id)",
        "status": "purchase_bill_status_enum NOT NULL DEFAULT 'DRAFT'",
        "subtotal": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "discount_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "taxable_value": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "cgst_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "sgst_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "igst_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "adjustment": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "total": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "extraction_status": "purchase_bill_extraction_status_enum NOT NULL DEFAULT 'NOT_STARTED'",
        "extraction_confidence": "NUMERIC(5, 2)",
        "attachment_id": f"INTEGER NULL REFERENCES {attachments_table}(id)",
        "purchase_order_id": f"INTEGER NULL {purchase_order_fk_sql}".strip(),
        "grn_id": f"INTEGER NULL {grn_fk_sql}".strip(),
        "extracted_json": "JSON",
        "remarks": "TEXT",
    }
    for column_name, column_sql in purchase_bill_columns.items():
        exists = db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'purchase_bills'
                  AND column_name = :column_name
                """
            ),
            {"schema_name": schema_name, "column_name": column_name},
        ).scalar_one_or_none()
        if exists is None:
            did_ddl = True
            db.execute(
                text(
                    f"""
                    ALTER TABLE {purchase_bills_table}
                    ADD COLUMN IF NOT EXISTS {column_name} {column_sql}
                    """
                )
            )
            did_repair = True

    if not _table_exists(db, schema_name, "purchase_bill_lines"):
        did_ddl = True
        db.execute(
            text(
                f"""
                CREATE TABLE IF NOT EXISTS {purchase_bill_lines_table} (
                    id SERIAL PRIMARY KEY,
                    purchase_bill_id INTEGER NOT NULL REFERENCES {purchase_bills_table}(id),
                    product_id INTEGER NULL REFERENCES {products_table}(id),
                    description_raw TEXT NOT NULL,
                    hsn_code VARCHAR(30) NULL,
                    qty NUMERIC(18, 3) NOT NULL DEFAULT 0,
                    unit VARCHAR(20) NULL,
                    unit_price NUMERIC(14, 4) NOT NULL DEFAULT 0,
                    discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    gst_percent NUMERIC(7, 2) NOT NULL DEFAULT 0,
                    line_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
                    batch_no VARCHAR(80) NULL,
                    expiry_date DATE NULL,
                    confidence_score NUMERIC(5, 2) NULL
                )
                """
            )
        )
        did_repair = True

    purchase_bill_line_columns = {
        "product_id": f"INTEGER NULL REFERENCES {products_table}(id)",
        "description_raw": "TEXT",
        "hsn_code": "VARCHAR(30)",
        "qty": "NUMERIC(18, 3) NOT NULL DEFAULT 0",
        "unit": "VARCHAR(20)",
        "unit_price": "NUMERIC(14, 4) NOT NULL DEFAULT 0",
        "discount_amount": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "gst_percent": "NUMERIC(7, 2) NOT NULL DEFAULT 0",
        "line_total": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "batch_no": "VARCHAR(80)",
        "expiry_date": "DATE",
        "confidence_score": "NUMERIC(5, 2)",
    }
    for column_name, column_sql in purchase_bill_line_columns.items():
        exists = db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'purchase_bill_lines'
                  AND column_name = :column_name
                """
            ),
            {"schema_name": schema_name, "column_name": column_name},
        ).scalar_one_or_none()
        if exists is None:
            did_ddl = True
            db.execute(
                text(
                    f"""
                    ALTER TABLE {purchase_bill_lines_table}
                    ADD COLUMN IF NOT EXISTS {column_name} {column_sql}
                    """
                )
            )
            did_repair = True

    if did_ddl:
        db.commit()

    if did_repair:
        logger.warning(
            "Auto-repaired tenant schema to support Purchase Bills",
            extra={"schema": schema_name},
        )


def _auto_repair_party_master_columns(db: Session, schema_name: str) -> None:
    if not _table_exists(db, schema_name, "parties"):
        return

    parties_table = _build_quoted_schema_table(schema_name, "parties")
    did_repair = False
    did_ddl = False

    party_master_columns = {
        "party_code": "VARCHAR(60)",
        "display_name": "VARCHAR(255)",
        "party_category": "VARCHAR(30)",
        "contact_person": "VARCHAR(255)",
        "designation": "VARCHAR(120)",
        "whatsapp_no": "VARCHAR(30)",
        "office_phone": "VARCHAR(30)",
        "website": "VARCHAR(255)",
        "address_line_2": "TEXT",
        "country": "VARCHAR(120)",
        "registration_type": "VARCHAR(30)",
        "drug_license_number": "VARCHAR(120)",
        "fssai_number": "VARCHAR(120)",
        "udyam_number": "VARCHAR(120)",
        "credit_limit": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "payment_terms": "VARCHAR(255)",
        "opening_balance": "NUMERIC(14, 2) NOT NULL DEFAULT 0",
        "outstanding_tracking_mode": "VARCHAR(30) NOT NULL DEFAULT 'BILL_WISE'",
    }

    for column_name, column_sql in party_master_columns.items():
        exists = db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'parties'
                  AND column_name = :column_name
                """
            ),
            {"schema_name": schema_name, "column_name": column_name},
        ).scalar_one_or_none()
        if exists is None:
            did_ddl = True
            db.execute(
                text(
                    f"""
                    ALTER TABLE {parties_table}
                    ADD COLUMN IF NOT EXISTS {column_name} {column_sql}
                    """
                )
            )
            did_repair = True

    party_type_metadata = db.execute(
        text(
            """
            SELECT data_type, udt_name
            FROM information_schema.columns
            WHERE table_schema = :schema_name
              AND table_name = 'parties'
              AND column_name = 'party_type'
            """
        ),
        {"schema_name": schema_name},
    ).first()

    if party_type_metadata is not None and party_type_metadata.data_type != "character varying":
        did_ddl = True
        db.execute(
            text(
                f"""
                ALTER TABLE {parties_table}
                ALTER COLUMN party_type TYPE VARCHAR(30)
                USING party_type::text
                """
            )
        )
        did_repair = True

    did_ddl = True
    db.execute(
        text(
            f"""
            UPDATE {parties_table}
            SET party_category = CASE party_type
                WHEN 'DISTRIBUTOR' THEN 'DISTRIBUTOR'
                WHEN 'SUPER_STOCKIST' THEN 'STOCKIST'
                WHEN 'HOSPITAL' THEN 'HOSPITAL'
                WHEN 'PHARMACY' THEN 'PHARMACY'
                WHEN 'RETAILER' THEN 'RETAILER'
                WHEN 'INSTITUTION' THEN 'INSTITUTION'
                WHEN 'MANUFACTURER' THEN 'OTHER'
                WHEN 'CONSUMER' THEN 'OTHER'
                ELSE party_category
            END
            WHERE party_category IS NULL
            """
        )
    )
    did_ddl = True
    db.execute(
        text(
            f"""
            UPDATE {parties_table}
            SET party_type = CASE party_type
                WHEN 'DISTRIBUTOR' THEN 'SUPPLIER'
                WHEN 'SUPER_STOCKIST' THEN 'SUPPLIER'
                WHEN 'MANUFACTURER' THEN 'SUPPLIER'
                WHEN 'HOSPITAL' THEN 'CUSTOMER'
                WHEN 'PHARMACY' THEN 'CUSTOMER'
                WHEN 'RETAILER' THEN 'CUSTOMER'
                WHEN 'INSTITUTION' THEN 'CUSTOMER'
                WHEN 'CONSUMER' THEN 'CUSTOMER'
                ELSE party_type
            END
            WHERE party_type IN (
                'DISTRIBUTOR',
                'SUPER_STOCKIST',
                'MANUFACTURER',
                'HOSPITAL',
                'PHARMACY',
                'RETAILER',
                'INSTITUTION',
                'CONSUMER'
            )
            """
        )
    )
    did_ddl = True
    db.execute(
        text(
            f"""
            UPDATE {parties_table}
            SET country = COALESCE(NULLIF(country, ''), 'India'),
                outstanding_tracking_mode = COALESCE(NULLIF(outstanding_tracking_mode, ''), 'BILL_WISE'),
                registration_type = CASE
                    WHEN gstin IS NOT NULL AND registration_type IS NULL THEN 'REGISTERED'
                    ELSE registration_type
                END
            """
        )
    )

    if did_ddl:
        db.commit()

    if did_repair:
        logger.warning(
            "Auto-repaired tenant schema to support Party Master fields",
            extra={"schema": schema_name},
        )


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
