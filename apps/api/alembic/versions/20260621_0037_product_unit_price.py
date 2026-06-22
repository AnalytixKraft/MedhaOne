"""add unit_price to products

Revision ID: 20260621_0037
Revises: 20260619_0036
Create Date: 2026-06-21 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260621_0037"
down_revision: str | Sequence[str] | None = "20260619_0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "products" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("products")}
    if "unit_price" not in columns:
        op.add_column("products", sa.Column("unit_price", sa.Numeric(14, 2), nullable=True))
        # Backfill from existing MRP / GST so saved products show a unit price at once.
        op.execute(
            "UPDATE products "
            "SET unit_price = ROUND(mrp / (1 + COALESCE(gst_rate, 0) / 100.0), 2) "
            "WHERE mrp IS NOT NULL AND unit_price IS NULL"
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "products" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("products")}
    if "unit_price" in columns:
        op.drop_column("products", "unit_price")
