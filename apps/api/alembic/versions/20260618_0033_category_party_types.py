"""add party_types link to categories

Revision ID: 20260618_0033
Revises: 20260312_0032
Create Date: 2026-06-18 10:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260618_0033"
down_revision: str | Sequence[str] | None = "20260312_0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "categories" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("categories")}
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
    if "categories" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("categories")}
    if "party_types" not in columns:
        return
    op.drop_column("categories", "party_types")
