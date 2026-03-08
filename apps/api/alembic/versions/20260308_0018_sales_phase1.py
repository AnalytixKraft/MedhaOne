"""add sales orders, reservations, and dispatch phase 1

Revision ID: 20260308_0018
Revises: 20260308_0017
Create Date: 2026-03-08 09:45:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260308_0018"
down_revision: str | None = "20260308_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()

    sales_order_status = postgresql.ENUM(
        "DRAFT",
        "CONFIRMED",
        "PARTIALLY_DISPATCHED",
        "DISPATCHED",
        "CANCELLED",
        name="sales_order_status_enum",
    )
    stock_reservation_status = postgresql.ENUM(
        "ACTIVE",
        "PARTIALLY_CONSUMED",
        "CONSUMED",
        "RELEASED",
        name="stock_reservation_status_enum",
    )
    dispatch_note_status = postgresql.ENUM(
        "DRAFT",
        "POSTED",
        "CANCELLED",
        name="dispatch_note_status_enum",
    )
    sales_order_status.create(bind, checkfirst=True)
    stock_reservation_status.create(bind, checkfirst=True)
    dispatch_note_status.create(bind, checkfirst=True)

    sales_order_status_ref = postgresql.ENUM(name="sales_order_status_enum", create_type=False)
    stock_reservation_status_ref = postgresql.ENUM(name="stock_reservation_status_enum", create_type=False)
    dispatch_note_status_ref = postgresql.ENUM(name="dispatch_note_status_enum", create_type=False)

    op.create_table(
        "sales_orders",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("so_number", sa.String(length=60), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("status", sales_order_status_ref, nullable=False),
        sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column("expected_dispatch_date", sa.Date(), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("subtotal", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("discount_percent", sa.Numeric(7, 2), nullable=False, server_default="0"),
        sa.Column("discount_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("tax_type", sa.String(length=20), nullable=True),
        sa.Column("tax_percent", sa.Numeric(7, 2), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("adjustment", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["parties.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sales_orders_id", "sales_orders", ["id"], unique=False)
    op.create_index("ix_sales_orders_so_number", "sales_orders", ["so_number"], unique=True)
    op.create_index("ix_sales_orders_customer_id", "sales_orders", ["customer_id"], unique=False)
    op.create_index("ix_sales_orders_warehouse_id", "sales_orders", ["warehouse_id"], unique=False)
    op.create_index("ix_sales_orders_status", "sales_orders", ["status"], unique=False)
    op.create_index("ix_sales_orders_order_date", "sales_orders", ["order_date"], unique=False)

    op.create_table(
        "sales_order_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sales_order_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("ordered_qty", sa.Numeric(18, 3), nullable=False),
        sa.Column("reserved_qty", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("dispatched_qty", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("unit_price", sa.Numeric(14, 4), nullable=False, server_default="0"),
        sa.Column("discount_percent", sa.Numeric(7, 2), nullable=False, server_default="0"),
        sa.Column("line_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("gst_rate", sa.Numeric(7, 2), nullable=False, server_default="0"),
        sa.Column("hsn_code", sa.String(length=30), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.CheckConstraint("ordered_qty > 0", name="ck_sales_order_line_ordered_qty_gt_zero"),
        sa.CheckConstraint("reserved_qty >= 0", name="ck_sales_order_line_reserved_qty_non_negative"),
        sa.CheckConstraint("dispatched_qty >= 0", name="ck_sales_order_line_dispatched_qty_non_negative"),
        sa.CheckConstraint("unit_price >= 0", name="ck_sales_order_line_unit_price_non_negative"),
        sa.CheckConstraint("discount_percent >= 0", name="ck_sales_order_line_discount_percent_non_negative"),
        sa.CheckConstraint("line_total >= 0", name="ck_sales_order_line_line_total_non_negative"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["sales_order_id"], ["sales_orders.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sales_order_lines_id", "sales_order_lines", ["id"], unique=False)
    op.create_index("ix_sales_order_lines_sales_order_id", "sales_order_lines", ["sales_order_id"], unique=False)

    op.create_table(
        "stock_reservations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sales_order_id", sa.Integer(), nullable=False),
        sa.Column("sales_order_line_id", sa.Integer(), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=True),
        sa.Column("reserved_qty", sa.Numeric(18, 3), nullable=False),
        sa.Column("consumed_qty", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("released_qty", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("status", stock_reservation_status_ref, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.CheckConstraint("reserved_qty > 0", name="ck_stock_reservations_reserved_qty_gt_zero"),
        sa.CheckConstraint("consumed_qty >= 0", name="ck_stock_reservations_consumed_qty_non_negative"),
        sa.CheckConstraint("released_qty >= 0", name="ck_stock_reservations_released_qty_non_negative"),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["sales_order_id"], ["sales_orders.id"]),
        sa.ForeignKeyConstraint(["sales_order_line_id"], ["sales_order_lines.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_stock_reservations_id", "stock_reservations", ["id"], unique=False)
    op.create_index("ix_stock_reservations_sales_order_id", "stock_reservations", ["sales_order_id"], unique=False)
    op.create_index("ix_stock_reservations_sales_order_line_id", "stock_reservations", ["sales_order_line_id"], unique=False)
    op.create_index(
        "ix_stock_reservations_wh_product_status",
        "stock_reservations",
        ["warehouse_id", "product_id", "status"],
        unique=False,
    )

    op.create_table(
        "dispatch_notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dispatch_number", sa.String(length=60), nullable=False),
        sa.Column("sales_order_id", sa.Integer(), nullable=False),
        sa.Column("customer_id", sa.Integer(), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("status", dispatch_note_status_ref, nullable=False),
        sa.Column("dispatch_date", sa.Date(), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("posted_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["parties.id"]),
        sa.ForeignKeyConstraint(["posted_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["sales_order_id"], ["sales_orders.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dispatch_notes_id", "dispatch_notes", ["id"], unique=False)
    op.create_index("ix_dispatch_notes_dispatch_number", "dispatch_notes", ["dispatch_number"], unique=True)
    op.create_index("ix_dispatch_notes_sales_order_id", "dispatch_notes", ["sales_order_id"], unique=False)
    op.create_index("ix_dispatch_notes_customer_id", "dispatch_notes", ["customer_id"], unique=False)
    op.create_index("ix_dispatch_notes_warehouse_id", "dispatch_notes", ["warehouse_id"], unique=False)
    op.create_index("ix_dispatch_notes_status", "dispatch_notes", ["status"], unique=False)
    op.create_index("ix_dispatch_notes_dispatch_date", "dispatch_notes", ["dispatch_date"], unique=False)

    op.create_table(
        "dispatch_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dispatch_note_id", sa.Integer(), nullable=False),
        sa.Column("sales_order_line_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("expiry_date_snapshot", sa.Date(), nullable=True),
        sa.Column("dispatched_qty", sa.Numeric(18, 3), nullable=False),
        sa.Column("unit_price_snapshot", sa.Numeric(14, 4), nullable=False, server_default="0"),
        sa.Column("line_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.CheckConstraint("dispatched_qty > 0", name="ck_dispatch_lines_dispatched_qty_gt_zero"),
        sa.CheckConstraint("unit_price_snapshot >= 0", name="ck_dispatch_lines_unit_price_snapshot_non_negative"),
        sa.CheckConstraint("line_total >= 0", name="ck_dispatch_lines_line_total_non_negative"),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"]),
        sa.ForeignKeyConstraint(["dispatch_note_id"], ["dispatch_notes.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["sales_order_line_id"], ["sales_order_lines.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dispatch_lines_id", "dispatch_lines", ["id"], unique=False)
    op.create_index("ix_dispatch_lines_dispatch_note_id", "dispatch_lines", ["dispatch_note_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_dispatch_lines_dispatch_note_id", table_name="dispatch_lines")
    op.drop_index("ix_dispatch_lines_id", table_name="dispatch_lines")
    op.drop_table("dispatch_lines")

    op.drop_index("ix_dispatch_notes_dispatch_date", table_name="dispatch_notes")
    op.drop_index("ix_dispatch_notes_status", table_name="dispatch_notes")
    op.drop_index("ix_dispatch_notes_warehouse_id", table_name="dispatch_notes")
    op.drop_index("ix_dispatch_notes_customer_id", table_name="dispatch_notes")
    op.drop_index("ix_dispatch_notes_sales_order_id", table_name="dispatch_notes")
    op.drop_index("ix_dispatch_notes_dispatch_number", table_name="dispatch_notes")
    op.drop_index("ix_dispatch_notes_id", table_name="dispatch_notes")
    op.drop_table("dispatch_notes")

    op.drop_index("ix_stock_reservations_wh_product_status", table_name="stock_reservations")
    op.drop_index("ix_stock_reservations_sales_order_line_id", table_name="stock_reservations")
    op.drop_index("ix_stock_reservations_sales_order_id", table_name="stock_reservations")
    op.drop_index("ix_stock_reservations_id", table_name="stock_reservations")
    op.drop_table("stock_reservations")

    op.drop_index("ix_sales_order_lines_sales_order_id", table_name="sales_order_lines")
    op.drop_index("ix_sales_order_lines_id", table_name="sales_order_lines")
    op.drop_table("sales_order_lines")

    op.drop_index("ix_sales_orders_order_date", table_name="sales_orders")
    op.drop_index("ix_sales_orders_status", table_name="sales_orders")
    op.drop_index("ix_sales_orders_warehouse_id", table_name="sales_orders")
    op.drop_index("ix_sales_orders_customer_id", table_name="sales_orders")
    op.drop_index("ix_sales_orders_so_number", table_name="sales_orders")
    op.drop_index("ix_sales_orders_id", table_name="sales_orders")
    op.drop_table("sales_orders")

    bind = op.get_bind()
    postgresql.ENUM(name="dispatch_note_status_enum").drop(bind, checkfirst=True)
    postgresql.ENUM(name="stock_reservation_status_enum").drop(bind, checkfirst=True)
    postgresql.ENUM(name="sales_order_status_enum").drop(bind, checkfirst=True)
