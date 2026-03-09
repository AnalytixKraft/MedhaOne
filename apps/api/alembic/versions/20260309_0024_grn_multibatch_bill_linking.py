"""enhance grn workflow with batch rows and bill linking

Revision ID: 20260309_0024
Revises: 20260308_0023
Create Date: 2026-03-09 11:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260309_0024"
down_revision = "20260308_0023"
branch_labels = None
depends_on = None


def _existing_columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name)}


def _existing_tables() -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return set(inspector.get_table_names())


def _existing_foreign_keys(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return set()
    return {
        foreign_key["name"]
        for foreign_key in inspector.get_foreign_keys(table_name)
        if foreign_key.get("name")
    }


def _existing_indexes(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table_name) if index.get("name")}


def upgrade() -> None:
    existing_grn_columns = _existing_columns("grns")
    if "purchase_bill_id" not in existing_grn_columns:
        op.add_column("grns", sa.Column("purchase_bill_id", sa.Integer(), nullable=True))
        existing_grn_columns.add("purchase_bill_id")
    if "remarks" not in existing_grn_columns:
        op.add_column("grns", sa.Column("remarks", sa.Text(), nullable=True))
        existing_grn_columns.add("remarks")

    existing_grn_foreign_keys = _existing_foreign_keys("grns")
    if "fk_grns_purchase_bill_id_purchase_bills" not in existing_grn_foreign_keys:
        op.create_foreign_key(
            "fk_grns_purchase_bill_id_purchase_bills",
            "grns",
            "purchase_bills",
            ["purchase_bill_id"],
            ["id"],
        )

    existing_grn_line_columns = _existing_columns("grn_lines")
    for column in [
        sa.Column("purchase_bill_line_id", sa.Integer(), nullable=True),
        sa.Column("product_name_snapshot", sa.String(length=255), nullable=True),
        sa.Column("ordered_qty_snapshot", sa.Numeric(18, 3), nullable=True),
        sa.Column("billed_qty_snapshot", sa.Numeric(18, 3), nullable=True),
        sa.Column("received_qty_total", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("free_qty_total", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("remarks", sa.Text(), nullable=True),
    ]:
        if column.name not in existing_grn_line_columns:
            op.add_column("grn_lines", column)
            existing_grn_line_columns.add(column.name)

    existing_grn_line_foreign_keys = _existing_foreign_keys("grn_lines")
    if "fk_grn_lines_purchase_bill_line_id_purchase_bill_lines" not in existing_grn_line_foreign_keys:
        op.create_foreign_key(
            "fk_grn_lines_purchase_bill_line_id_purchase_bill_lines",
            "grn_lines",
            "purchase_bill_lines",
            ["purchase_bill_line_id"],
            ["id"],
        )
    op.alter_column("grn_lines", "po_line_id", existing_type=sa.Integer(), nullable=True)
    op.alter_column("grn_lines", "batch_id", existing_type=sa.Integer(), nullable=True)
    op.alter_column("grn_lines", "expiry_date", existing_type=sa.Date(), nullable=True)
    op.execute("UPDATE grn_lines SET received_qty_total = received_qty, free_qty_total = free_qty")
    op.alter_column("grn_lines", "received_qty_total", server_default=None)
    op.alter_column("grn_lines", "free_qty_total", server_default=None)

    existing_tables = _existing_tables()
    created_batch_table = False
    if "grn_batch_lines" not in existing_tables:
        op.create_table(
            "grn_batch_lines",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("grn_line_id", sa.Integer(), sa.ForeignKey("grn_lines.id"), nullable=False),
            sa.Column("batch_no", sa.String(length=80), nullable=False),
            sa.Column("expiry_date", sa.Date(), nullable=False),
            sa.Column("mfg_date", sa.Date(), nullable=True),
            sa.Column("mrp", sa.Numeric(14, 2), nullable=True),
            sa.Column("received_qty", sa.Numeric(18, 3), nullable=False),
            sa.Column("free_qty", sa.Numeric(18, 3), nullable=False, server_default="0"),
            sa.Column("unit_cost", sa.Numeric(14, 4), nullable=True),
            sa.Column("batch_id", sa.Integer(), sa.ForeignKey("batches.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.CheckConstraint("received_qty > 0", name="ck_grn_batch_line_received_qty_gt_zero"),
            sa.CheckConstraint("free_qty >= 0", name="ck_grn_batch_line_free_qty_non_negative"),
        )
        created_batch_table = True
    existing_batch_indexes = _existing_indexes("grn_batch_lines")
    if "ix_grn_batch_lines_grn_line_id" not in existing_batch_indexes:
        op.create_index("ix_grn_batch_lines_grn_line_id", "grn_batch_lines", ["grn_line_id"])

    if created_batch_table:
        op.execute(
            """
            INSERT INTO grn_batch_lines (
                grn_line_id,
                batch_no,
                expiry_date,
                received_qty,
                free_qty,
                unit_cost,
                batch_id
            )
            SELECT
                gl.id,
                COALESCE(b.batch_no, CONCAT('LEGACY-BATCH-', gl.id)),
                COALESCE(gl.expiry_date, b.expiry_date),
                gl.received_qty,
                gl.free_qty,
                gl.unit_cost,
                gl.batch_id
            FROM grn_lines gl
            LEFT JOIN batches b ON b.id = gl.batch_id
            WHERE gl.received_qty > 0
            """
        )


def downgrade() -> None:
    existing_tables = _existing_tables()

    if "grn_batch_lines" in existing_tables:
        existing_batch_indexes = _existing_indexes("grn_batch_lines")
        if "ix_grn_batch_lines_grn_line_id" in existing_batch_indexes:
            op.drop_index("ix_grn_batch_lines_grn_line_id", table_name="grn_batch_lines")
        op.drop_table("grn_batch_lines")

    existing_grn_line_foreign_keys = _existing_foreign_keys("grn_lines")
    if "fk_grn_lines_purchase_bill_line_id_purchase_bill_lines" in existing_grn_line_foreign_keys:
        op.drop_constraint(
            "fk_grn_lines_purchase_bill_line_id_purchase_bill_lines",
            "grn_lines",
            type_="foreignkey",
        )
    existing_grn_line_columns = _existing_columns("grn_lines")
    for column_name in [
        "remarks",
        "free_qty_total",
        "received_qty_total",
        "billed_qty_snapshot",
        "ordered_qty_snapshot",
        "product_name_snapshot",
        "purchase_bill_line_id",
    ]:
        if column_name in existing_grn_line_columns:
            op.drop_column("grn_lines", column_name)

    existing_grn_foreign_keys = _existing_foreign_keys("grns")
    if "fk_grns_purchase_bill_id_purchase_bills" in existing_grn_foreign_keys:
        op.drop_constraint(
            "fk_grns_purchase_bill_id_purchase_bills",
            "grns",
            type_="foreignkey",
        )
    existing_grn_columns = _existing_columns("grns")
    if "remarks" in existing_grn_columns:
        op.drop_column("grns", "remarks")
    if "purchase_bill_id" in existing_grn_columns:
        op.drop_column("grns", "purchase_bill_id")
