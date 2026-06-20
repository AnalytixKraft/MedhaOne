"""add gst_status and gst_taxpayer_type to parties

Revision ID: 20260618_0034
Revises: 20260618_0033
Create Date: 2026-06-18 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260618_0034"
down_revision: str | Sequence[str] | None = "20260618_0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "parties" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("parties")}
    if "gst_status" not in columns:
        op.add_column("parties", sa.Column("gst_status", sa.String(length=60), nullable=True))
    if "gst_taxpayer_type" not in columns:
        op.add_column(
            "parties", sa.Column("gst_taxpayer_type", sa.String(length=120), nullable=True)
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "parties" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("parties")}
    if "gst_taxpayer_type" in columns:
        op.drop_column("parties", "gst_taxpayer_type")
    if "gst_status" in columns:
        op.drop_column("parties", "gst_status")
