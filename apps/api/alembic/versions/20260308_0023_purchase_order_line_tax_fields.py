"""add purchase order line tax fields

Revision ID: 20260308_0023
Revises: 20260308_0022
Create Date: 2026-03-08 23:10:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260308_0023"
down_revision: str | None = "20260308_0022"
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
    existing_columns = _existing_columns("purchase_order_lines")
    for column in [
        sa.Column("discount_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("taxable_value", sa.Numeric(14, 2), nullable=True),
        sa.Column("gst_percent", sa.Numeric(5, 2), nullable=True),
        sa.Column("cgst_percent", sa.Numeric(5, 2), nullable=True),
        sa.Column("sgst_percent", sa.Numeric(5, 2), nullable=True),
        sa.Column("igst_percent", sa.Numeric(5, 2), nullable=True),
        sa.Column("cgst_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("sgst_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("igst_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("tax_amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("line_total", sa.Numeric(14, 2), nullable=True),
    ]:
        if column.name not in existing_columns:
            op.add_column("purchase_order_lines", column)
            existing_columns.add(column.name)

    op.execute(
        """
        UPDATE purchase_order_lines
        SET discount_amount = COALESCE(discount_amount, 0),
            taxable_value = COALESCE(taxable_value, COALESCE(ordered_qty, 0) * COALESCE(unit_cost, 0)),
            gst_percent = COALESCE(gst_percent, 0),
            cgst_percent = COALESCE(cgst_percent, 0),
            sgst_percent = COALESCE(sgst_percent, 0),
            igst_percent = COALESCE(igst_percent, 0),
            cgst_amount = COALESCE(cgst_amount, 0),
            sgst_amount = COALESCE(sgst_amount, 0),
            igst_amount = COALESCE(igst_amount, 0),
            tax_amount = COALESCE(tax_amount, 0),
            line_total = COALESCE(
                line_total,
                COALESCE(ordered_qty, 0) * COALESCE(unit_cost, 0)
            )
        """
    )

    with op.batch_alter_table("purchase_order_lines") as batch_op:
        for column_name, column_type in [
            ("discount_amount", sa.Numeric(14, 2)),
            ("taxable_value", sa.Numeric(14, 2)),
            ("gst_percent", sa.Numeric(5, 2)),
            ("cgst_percent", sa.Numeric(5, 2)),
            ("sgst_percent", sa.Numeric(5, 2)),
            ("igst_percent", sa.Numeric(5, 2)),
            ("cgst_amount", sa.Numeric(14, 2)),
            ("sgst_amount", sa.Numeric(14, 2)),
            ("igst_amount", sa.Numeric(14, 2)),
            ("tax_amount", sa.Numeric(14, 2)),
            ("line_total", sa.Numeric(14, 2)),
        ]:
            if column_name in existing_columns:
                batch_op.alter_column(column_name, existing_type=column_type, nullable=False)

        existing_constraints = _existing_check_constraints("purchase_order_lines")
        if "ck_po_line_gst_percent_non_negative" not in existing_constraints:
            batch_op.create_check_constraint(
                "ck_po_line_gst_percent_non_negative",
                "gst_percent >= 0",
            )
        if "ck_po_line_total_non_negative" not in existing_constraints:
            batch_op.create_check_constraint(
                "ck_po_line_total_non_negative",
                "line_total >= 0",
            )


def downgrade() -> None:
    existing_columns = _existing_columns("purchase_order_lines")
    existing_constraints = _existing_check_constraints("purchase_order_lines")

    with op.batch_alter_table("purchase_order_lines") as batch_op:
        if "ck_po_line_total_non_negative" in existing_constraints:
            batch_op.drop_constraint("ck_po_line_total_non_negative", type_="check")
        if "ck_po_line_gst_percent_non_negative" in existing_constraints:
            batch_op.drop_constraint("ck_po_line_gst_percent_non_negative", type_="check")

    for column_name in [
        "line_total",
        "tax_amount",
        "igst_amount",
        "sgst_amount",
        "cgst_amount",
        "igst_percent",
        "sgst_percent",
        "cgst_percent",
        "gst_percent",
        "taxable_value",
        "discount_amount",
    ]:
        if column_name in existing_columns:
            op.drop_column("purchase_order_lines", column_name)
