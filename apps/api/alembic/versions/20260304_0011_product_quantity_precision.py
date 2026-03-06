"""add quantity precision to products

Revision ID: 20260304_0011
Revises: 20260303_0010
Create Date: 2026-03-04 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260304_0011"
down_revision: str | None = "20260303_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("quantity_precision", sa.Integer(), nullable=True, server_default="0"),
    )

    op.execute(
        """
        UPDATE products
        SET quantity_precision = CASE
            WHEN UPPER(uom) IN (
                'G', 'GM', 'GRAM', 'GRAMS',
                'KG', 'KGS', 'KILOGRAM', 'KILOGRAMS',
                'L', 'LITER', 'LITERS', 'LITRE', 'LITRES',
                'LTR', 'LTRS',
                'ML', 'MILLILITER', 'MILLILITERS', 'MILLILITRE', 'MILLILITRES'
            ) THEN 3
            ELSE 0
        END
        """
    )

    op.alter_column("products", "quantity_precision", nullable=False, server_default="0")
    op.create_check_constraint(
        "ck_products_quantity_precision_range",
        "products",
        "quantity_precision >= 0 AND quantity_precision <= 3",
    )


def downgrade() -> None:
    op.drop_constraint("ck_products_quantity_precision_range", "products", type_="check")
    op.drop_column("products", "quantity_precision")
