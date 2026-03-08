"""add user theme preference

Revision ID: 20260308_0017
Revises: 20260307_0016
Create Date: 2026-03-08 10:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect, text

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260308_0017"
down_revision: str | None = "20260307_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    schema_names = ["public"]
    organization_schemas = bind.execute(
        text(
            """
            SELECT schema_name
            FROM public.organizations
            WHERE is_active IS TRUE
            """
        )
    ).scalars().all()
    schema_names.extend(schema for schema in organization_schemas if isinstance(schema, str))

    for schema_name in dict.fromkeys(schema_names):
        user_tables = inspector.get_table_names(schema=schema_name)
        if "users" not in user_tables:
            continue
        user_columns = {
            column["name"] for column in inspector.get_columns("users", schema=schema_name)
        }
        if "theme_preference" in user_columns:
            continue
        op.add_column(
            "users",
            sa.Column(
                "theme_preference",
                sa.String(length=16),
                nullable=False,
                server_default="system",
            ),
            schema=schema_name,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    schema_names = ["public"]
    organization_schemas = bind.execute(
        text(
            """
            SELECT schema_name
            FROM public.organizations
            WHERE is_active IS TRUE
            """
        )
    ).scalars().all()
    schema_names.extend(schema for schema in organization_schemas if isinstance(schema, str))

    for schema_name in dict.fromkeys(schema_names):
        user_tables = inspector.get_table_names(schema=schema_name)
        if "users" not in user_tables:
            continue
        user_columns = {
            column["name"] for column in inspector.get_columns("users", schema=schema_name)
        }
        if "theme_preference" not in user_columns:
            continue
        op.drop_column("users", "theme_preference", schema=schema_name)
