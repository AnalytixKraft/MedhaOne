"""add gstin and pan number to parties

Revision ID: 20260305_0013
Revises: 20260305_0012
Create Date: 2026-03-05 23:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260305_0013"
down_revision: str | None = "20260305_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("parties")}

    if "gstin" not in columns:
        op.add_column("parties", sa.Column("gstin", sa.String(length=15), nullable=True))
    if "pan_number" not in columns:
        op.add_column("parties", sa.Column("pan_number", sa.String(length=10), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("parties")}

    if "pan_number" in columns:
        op.drop_column("parties", "pan_number")
    if "gstin" in columns:
        op.drop_column("parties", "gstin")
