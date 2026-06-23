"""enhance product master with storage defaults and decimal flag

Revision ID: 20260309_0028
Revises: 20260309_0027
Create Date: 2026-03-09 22:25:00.000000
"""

import sqlalchemy as sa

from alembic import op

revision = "20260309_0028"
down_revision = "20260309_0027"
branch_labels = None
depends_on = None


def _column_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    product_columns = _column_names("products")

    additions: list[sa.Column] = []
    if "display_name" not in product_columns:
        additions.append(sa.Column("display_name", sa.String(length=255), nullable=True))
    if "category" not in product_columns:
        additions.append(sa.Column("category", sa.String(length=120), nullable=True))
    if "decimal_allowed" not in product_columns:
        additions.append(
            sa.Column("decimal_allowed", sa.Boolean(), nullable=False, server_default=sa.text("false"))
        )
    if "default_warehouse_id" not in product_columns:
        additions.append(sa.Column("default_warehouse_id", sa.Integer(), nullable=True))
    if "rack_number" not in product_columns:
        additions.append(sa.Column("rack_number", sa.String(length=120), nullable=True))
    if "default_purchase_rate" not in product_columns:
        additions.append(sa.Column("default_purchase_rate", sa.Numeric(14, 2), nullable=True))
    if "default_sale_rate" not in product_columns:
        additions.append(sa.Column("default_sale_rate", sa.Numeric(14, 2), nullable=True))
    if "mrp" not in product_columns:
        additions.append(sa.Column("mrp", sa.Numeric(14, 2), nullable=True))

    for column in additions:
        op.add_column("products", column)

    if "default_warehouse_id" not in product_columns:
        op.create_foreign_key(
            "fk_products_default_warehouse_id",
            "products",
            "warehouses",
            ["default_warehouse_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(
            "ix_products_default_warehouse_id",
            "products",
            ["default_warehouse_id"],
            unique=False,
        )

    if "decimal_allowed" not in product_columns and "quantity_precision" in product_columns:
        op.execute(
            """
            UPDATE products
            SET decimal_allowed = CASE
                WHEN COALESCE(quantity_precision, 0) > 0 THEN TRUE
                ELSE FALSE
            END
            """
        )


def downgrade() -> None:
    product_columns = _column_names("products")

    if "default_warehouse_id" in product_columns:
        op.drop_index("ix_products_default_warehouse_id", table_name="products")
        op.drop_constraint("fk_products_default_warehouse_id", "products", type_="foreignkey")

    for column_name in [
        "mrp",
        "default_sale_rate",
        "default_purchase_rate",
        "rack_number",
        "default_warehouse_id",
        "decimal_allowed",
        "category",
        "display_name",
    ]:
        if column_name in product_columns:
            op.drop_column("products", column_name)
