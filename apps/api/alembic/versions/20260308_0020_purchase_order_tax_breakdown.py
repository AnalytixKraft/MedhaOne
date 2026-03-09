"""add purchase order tax breakdown fields

Revision ID: 20260308_0020
Revises: 20260308_0019
Create Date: 2026-03-08 20:45:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260308_0020"
down_revision: str | None = "20260308_0019"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _existing_columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name)}


def _existing_check_constraints(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {
        constraint["name"]
        for constraint in inspector.get_check_constraints(table_name)
        if constraint.get("name")
    }


def upgrade() -> None:
    for statement in [
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tax_type VARCHAR(20)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(14, 2)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14, 2)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS taxable_value NUMERIC(14, 2)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5, 2)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cgst_percent NUMERIC(5, 2)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sgst_percent NUMERIC(5, 2)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS igst_percent NUMERIC(5, 2)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(14, 2)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(14, 2)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(14, 2)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS adjustment NUMERIC(14, 2)",
        "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS final_total NUMERIC(14, 2)",
    ]:
        op.execute(statement)

    existing_columns = _existing_columns("purchase_orders")

    op.execute(
        """
        UPDATE purchase_orders
        SET subtotal = COALESCE(subtotal, 0),
            discount_percent = COALESCE(discount_percent, 0),
            discount_amount = COALESCE(discount_amount, 0),
            taxable_value = COALESCE(taxable_value, 0),
            gst_percent = COALESCE(gst_percent, 0),
            cgst_percent = COALESCE(cgst_percent, 0),
            sgst_percent = COALESCE(sgst_percent, 0),
            igst_percent = COALESCE(igst_percent, 0),
            cgst_amount = COALESCE(cgst_amount, 0),
            sgst_amount = COALESCE(sgst_amount, 0),
            igst_amount = COALESCE(igst_amount, 0),
            adjustment = COALESCE(adjustment, 0),
            final_total = COALESCE(final_total, 0)
        """
    )

    with op.batch_alter_table("purchase_orders") as batch_op:
        for column_name, column_type in [
            ("subtotal", sa.Numeric(14, 2)),
            ("discount_percent", sa.Numeric(5, 2)),
            ("discount_amount", sa.Numeric(14, 2)),
            ("taxable_value", sa.Numeric(14, 2)),
            ("gst_percent", sa.Numeric(5, 2)),
            ("cgst_percent", sa.Numeric(5, 2)),
            ("sgst_percent", sa.Numeric(5, 2)),
            ("igst_percent", sa.Numeric(5, 2)),
            ("cgst_amount", sa.Numeric(14, 2)),
            ("sgst_amount", sa.Numeric(14, 2)),
            ("igst_amount", sa.Numeric(14, 2)),
            ("adjustment", sa.Numeric(14, 2)),
            ("final_total", sa.Numeric(14, 2)),
        ]:
            if column_name in existing_columns:
                batch_op.alter_column(column_name, existing_type=column_type, nullable=False)

        existing_constraints = _existing_check_constraints("purchase_orders")
        if "ck_purchase_orders_discount_percent_range" not in existing_constraints:
            batch_op.create_check_constraint(
                "ck_purchase_orders_discount_percent_range",
                "discount_percent >= 0 AND discount_percent <= 100",
            )
        if "ck_purchase_orders_gst_percent_non_negative" not in existing_constraints:
            batch_op.create_check_constraint(
                "ck_purchase_orders_gst_percent_non_negative",
                "gst_percent >= 0",
            )
        if "ck_purchase_orders_final_total_non_negative" not in existing_constraints:
            batch_op.create_check_constraint(
                "ck_purchase_orders_final_total_non_negative",
                "final_total >= 0",
            )


def downgrade() -> None:
    existing_columns = _existing_columns("purchase_orders")
    existing_constraints = _existing_check_constraints("purchase_orders")

    with op.batch_alter_table("purchase_orders") as batch_op:
        if "ck_purchase_orders_final_total_non_negative" in existing_constraints:
            batch_op.drop_constraint("ck_purchase_orders_final_total_non_negative", type_="check")
        if "ck_purchase_orders_gst_percent_non_negative" in existing_constraints:
            batch_op.drop_constraint("ck_purchase_orders_gst_percent_non_negative", type_="check")
        if "ck_purchase_orders_discount_percent_range" in existing_constraints:
            batch_op.drop_constraint("ck_purchase_orders_discount_percent_range", type_="check")

    for column_name in [
        "final_total",
        "adjustment",
        "igst_amount",
        "sgst_amount",
        "cgst_amount",
        "igst_percent",
        "sgst_percent",
        "cgst_percent",
        "gst_percent",
        "taxable_value",
        "discount_amount",
        "discount_percent",
        "subtotal",
        "tax_type",
    ]:
        if column_name in existing_columns:
            op.drop_column("purchase_orders", column_name)
