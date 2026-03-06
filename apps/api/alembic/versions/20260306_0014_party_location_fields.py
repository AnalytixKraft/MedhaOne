"""add state city pincode to parties

Revision ID: 20260306_0014
Revises: 20260305_0013
Create Date: 2026-03-06 12:15:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260306_0014"
down_revision: str | None = "20260305_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("parties")}

    if "state" not in columns:
        op.add_column("parties", sa.Column("state", sa.String(length=120), nullable=True))
    if "city" not in columns:
        op.add_column("parties", sa.Column("city", sa.String(length=120), nullable=True))
    if "pincode" not in columns:
        op.add_column("parties", sa.Column("pincode", sa.String(length=10), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("parties")}

    if "pincode" in columns:
        op.drop_column("parties", "pincode")
    if "city" in columns:
        op.drop_column("parties", "city")
    if "state" in columns:
        op.drop_column("parties", "state")
