"""add stock source provenance

Revision ID: 20260309_0027
Revises: 20260309_0026
Create Date: 2026-03-09 23:55:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260309_0027"
down_revision: str | Sequence[str] | None = "20260309_0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    purchase_orders_exists = "purchase_orders" in inspector.get_table_names()
    purchase_bills_exists = "purchase_bills" in inspector.get_table_names()
    grns_exists = "grns" in inspector.get_table_names()
    grn_lines_exists = "grn_lines" in inspector.get_table_names()
    grn_batch_lines_exists = "grn_batch_lines" in inspector.get_table_names()

    inventory_columns = {column["name"] for column in inspector.get_columns("inventory_ledger")}
    if "unit_cost" not in inventory_columns:
        op.add_column("inventory_ledger", sa.Column("unit_cost", sa.Numeric(14, 4), nullable=True))

    if "stock_source_provenance" not in inspector.get_table_names():
        op.create_table(
            "stock_source_provenance",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("ledger_id", sa.Integer(), sa.ForeignKey("inventory_ledger.id"), nullable=False),
            sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("parties.id"), nullable=False),
            sa.Column(
                "purchase_order_id",
                sa.Integer(),
                sa.ForeignKey("purchase_orders.id") if purchase_orders_exists else None,
                nullable=False,
            ),
            sa.Column(
                "purchase_bill_id",
                sa.Integer(),
                sa.ForeignKey("purchase_bills.id") if purchase_bills_exists else None,
                nullable=True,
            ),
            sa.Column(
                "grn_id",
                sa.Integer(),
                sa.ForeignKey("grns.id") if grns_exists else None,
                nullable=False,
            ),
            sa.Column(
                "grn_line_id",
                sa.Integer(),
                sa.ForeignKey("grn_lines.id") if grn_lines_exists else None,
                nullable=False,
            ),
            sa.Column(
                "grn_batch_line_id",
                sa.Integer(),
                sa.ForeignKey("grn_batch_lines.id") if grn_batch_lines_exists else None,
                nullable=False,
            ),
            sa.Column("warehouse_id", sa.Integer(), sa.ForeignKey("warehouses.id"), nullable=False),
            sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
            sa.Column("batch_id", sa.Integer(), sa.ForeignKey("batches.id"), nullable=False),
            sa.Column("batch_no", sa.String(length=100), nullable=False),
            sa.Column("expiry_date", sa.Date(), nullable=False),
            sa.Column("inward_date", sa.Date(), nullable=False),
            sa.Column("received_qty", sa.Numeric(18, 3), nullable=False),
            sa.Column("free_qty", sa.Numeric(18, 3), nullable=False, server_default=sa.text("0")),
            sa.Column("unit_cost_snapshot", sa.Numeric(14, 4), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
            sa.UniqueConstraint("ledger_id", name="uq_stock_source_provenance_ledger_id"),
        )
        op.create_index(
            "ix_stock_source_provenance_supplier_id",
            "stock_source_provenance",
            ["supplier_id"],
            unique=False,
        )
        op.create_index(
            "ix_stock_source_provenance_purchase_order_id",
            "stock_source_provenance",
            ["purchase_order_id"],
            unique=False,
        )
        op.create_index(
            "ix_stock_source_provenance_purchase_bill_id",
            "stock_source_provenance",
            ["purchase_bill_id"],
            unique=False,
        )
        op.create_index(
            "ix_stock_source_provenance_grn_id",
            "stock_source_provenance",
            ["grn_id"],
            unique=False,
        )
        op.create_index(
            "ix_stock_source_provenance_bucket",
            "stock_source_provenance",
            ["warehouse_id", "product_id", "batch_id"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "stock_source_provenance" in inspector.get_table_names():
        op.drop_index("ix_stock_source_provenance_bucket", table_name="stock_source_provenance")
        op.drop_index("ix_stock_source_provenance_grn_id", table_name="stock_source_provenance")
        op.drop_index("ix_stock_source_provenance_purchase_bill_id", table_name="stock_source_provenance")
        op.drop_index("ix_stock_source_provenance_purchase_order_id", table_name="stock_source_provenance")
        op.drop_index("ix_stock_source_provenance_supplier_id", table_name="stock_source_provenance")
        op.drop_table("stock_source_provenance")
