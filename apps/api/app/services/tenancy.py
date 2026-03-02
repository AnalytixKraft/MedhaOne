from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import IS_POSTGRES
from app.core.exceptions import AppException
from app.core.tenancy import build_tenant_schema_name, quote_schema_name, validate_org_slug

logger = logging.getLogger(__name__)
ROOT_DIR = Path(__file__).resolve().parents[2]
ALEMBIC_INI_PATH = ROOT_DIR / "alembic.ini"


def provision_organization_schema(
    db: Session,
    *,
    slug: str,
    name: str,
    max_users: int,
    created_by_id: str | int | None = None,
) -> str:
    if not IS_POSTGRES:
        raise AppException(
            error_code="TENANCY_UNAVAILABLE",
            message="Schema-per-tenant mode requires PostgreSQL",
            status_code=400,
        )

    safe_slug = validate_org_slug(slug)
    schema_name = build_tenant_schema_name(safe_slug)

    db.execute(
        text(
            """
            INSERT INTO public.organizations (id, name, schema_name, max_users, is_active, created_by_id)
            VALUES (:org_id, :name, :schema_name, :max_users, TRUE, :created_by_id)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                schema_name = EXCLUDED.schema_name,
                max_users = EXCLUDED.max_users,
                is_active = TRUE,
                updated_at = NOW()
            """
        ),
        {
            "org_id": safe_slug,
            "name": name,
            "schema_name": schema_name,
            "max_users": max_users,
            "created_by_id": str(created_by_id) if created_by_id is not None else None,
        },
    )
    db.execute(text(f"CREATE SCHEMA IF NOT EXISTS {quote_schema_name(schema_name)}"))
    db.commit()

    run_tenant_schema_migrations(schema_name)
    logger.info("Provisioned tenant schema", extra={"organization_slug": safe_slug, "schema": schema_name})
    return schema_name


def run_tenant_schema_migrations(schema_name: str) -> None:
    if not IS_POSTGRES:
        return

    safe_schema = schema_name if schema_name.startswith("org_") else build_tenant_schema_name(schema_name)
    config = Config(str(ALEMBIC_INI_PATH))
    settings = get_settings()
    config.set_main_option("sqlalchemy.url", settings.database_url)
    config.attributes["schema"] = safe_schema
    command.upgrade(config, "head")
