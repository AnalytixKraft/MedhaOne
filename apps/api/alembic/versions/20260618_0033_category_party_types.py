"""add party_types link to categories

Revision ID: 20260618_0033
Revises: 20260312_0032
Create Date: 2026-06-18 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260618_0033"
down_revision: str | Sequence[str] | None = "20260312_0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _current_schema(bind) -> str:
    # During tenant provisioning the search_path is the tenant schema; the inspector's
    # cached default_schema_name is "public", so existence guards must target the live
    # current_schema() or they wrongly check public and skip the tenant.
    return bind.execute(sa.text("SELECT current_schema()")).scalar() or "public"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    schema = _current_schema(bind)
    if "categories" not in inspector.get_table_names(schema=schema):
        return
    columns = {col["name"] for col in inspector.get_columns("categories", schema=schema)}
    if "party_types" in columns:
        return

    op.add_column("categories", sa.Column("party_types", sa.JSON(), nullable=True))
    # Backfill from the previously hardcoded customer/supplier category mapping.
    op.execute(
        "UPDATE categories SET party_types = '[\"CUSTOMER\"]'::json "
        "WHERE upper(name) IN ('RETAILER', 'HOSPITAL', 'PHARMACY', 'INSTITUTION')"
    )
    op.execute(
        "UPDATE categories SET party_types = '[\"SUPPLIER\"]'::json "
        "WHERE upper(name) IN ('DISTRIBUTOR', 'STOCKIST')"
    )
    op.execute(
        "UPDATE categories SET party_types = '[\"CUSTOMER\", \"SUPPLIER\"]'::json "
        "WHERE party_types IS NULL"
    )
    op.alter_column(
        "categories",
        "party_types",
        nullable=False,
        server_default=sa.text("'[\"CUSTOMER\", \"SUPPLIER\"]'::json"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    schema = _current_schema(bind)
    if "categories" not in inspector.get_table_names(schema=schema):
        return
    columns = {col["name"] for col in inspector.get_columns("categories", schema=schema)}
    if "party_types" not in columns:
        return
    op.drop_column("categories", "party_types")
