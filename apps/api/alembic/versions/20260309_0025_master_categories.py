"""add master categories table

Revision ID: 20260309_0025
Revises: 20260309_0024
Create Date: 2026-03-09 22:10:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260309_0025"
down_revision: str | Sequence[str] | None = "20260309_0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "categories" in inspector.get_table_names():
        return

    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("TRUE")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_categories_name", "categories", ["name"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "categories" not in inspector.get_table_names():
        return

    op.drop_index("ix_categories_name", table_name="categories")
    op.drop_table("categories")
