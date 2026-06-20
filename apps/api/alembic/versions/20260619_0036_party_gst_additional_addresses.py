"""add gst_additional_addresses to parties

Revision ID: 20260619_0036
Revises: 20260619_0035
Create Date: 2026-06-19 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260619_0036"
down_revision: str | Sequence[str] | None = "20260619_0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "parties" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("parties")}
    if "gst_additional_addresses" not in columns:
        op.add_column("parties", sa.Column("gst_additional_addresses", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "parties" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("parties")}
    if "gst_additional_addresses" in columns:
        op.drop_column("parties", "gst_additional_addresses")
