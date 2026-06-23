"""add master uoms table

Revision ID: 20260622_0038
Revises: 20260621_0037
Create Date: 2026-06-22 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260622_0038"
down_revision: str | Sequence[str] | None = "20260621_0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "uoms" in inspector.get_table_names():
        return

    op.create_table(
        "uoms",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=30), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("TRUE")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_uoms_name", "uoms", ["name"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "uoms" not in inspector.get_table_names():
        return

    op.drop_index("ix_uoms_name", table_name="uoms")
    op.drop_table("uoms")
