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


def upgrade() -> None:
    for column in [
        sa.Column("tax_type", sa.String(length=20), nullable=True),
        sa.Column("subtotal", sa.Numeric(14, 2), nullable=True),
        sa.Column("discount_percent", sa.Numeric(5, 2), nullable=True),
        sa.Column("discount_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("taxable_value", sa.Numeric(14, 2), nullable=True),
        sa.Column("gst_percent", sa.Numeric(5, 2), nullable=True),
        sa.Column("cgst_percent", sa.Numeric(5, 2), nullable=True),
        sa.Column("sgst_percent", sa.Numeric(5, 2), nullable=True),
        sa.Column("igst_percent", sa.Numeric(5, 2), nullable=True),
        sa.Column("cgst_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("sgst_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("igst_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("adjustment", sa.Numeric(14, 2), nullable=True),
        sa.Column("final_total", sa.Numeric(14, 2), nullable=True),
    ]:
        op.add_column("purchase_orders", column)

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
        batch_op.alter_column("subtotal", existing_type=sa.Numeric(14, 2), nullable=False)
        batch_op.alter_column("discount_percent", existing_type=sa.Numeric(5, 2), nullable=False)
        batch_op.alter_column("discount_amount", existing_type=sa.Numeric(14, 2), nullable=False)
        batch_op.alter_column("taxable_value", existing_type=sa.Numeric(14, 2), nullable=False)
        batch_op.alter_column("gst_percent", existing_type=sa.Numeric(5, 2), nullable=False)
        batch_op.alter_column("cgst_percent", existing_type=sa.Numeric(5, 2), nullable=False)
        batch_op.alter_column("sgst_percent", existing_type=sa.Numeric(5, 2), nullable=False)
        batch_op.alter_column("igst_percent", existing_type=sa.Numeric(5, 2), nullable=False)
        batch_op.alter_column("cgst_amount", existing_type=sa.Numeric(14, 2), nullable=False)
        batch_op.alter_column("sgst_amount", existing_type=sa.Numeric(14, 2), nullable=False)
        batch_op.alter_column("igst_amount", existing_type=sa.Numeric(14, 2), nullable=False)
        batch_op.alter_column("adjustment", existing_type=sa.Numeric(14, 2), nullable=False)
        batch_op.alter_column("final_total", existing_type=sa.Numeric(14, 2), nullable=False)
        batch_op.create_check_constraint(
            "ck_purchase_orders_discount_percent_range",
            "discount_percent >= 0 AND discount_percent <= 100",
        )
        batch_op.create_check_constraint(
            "ck_purchase_orders_gst_percent_non_negative",
            "gst_percent >= 0",
        )
        batch_op.create_check_constraint(
            "ck_purchase_orders_final_total_non_negative",
            "final_total >= 0",
        )


def downgrade() -> None:
    with op.batch_alter_table("purchase_orders") as batch_op:
        batch_op.drop_constraint("ck_purchase_orders_final_total_non_negative", type_="check")
        batch_op.drop_constraint("ck_purchase_orders_gst_percent_non_negative", type_="check")
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
        op.drop_column("purchase_orders", column_name)
