"""add purchase order and grn workflow tables

Revision ID: 20260227_0004
Revises: 20260226_0003
Create Date: 2026-02-27 09:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260227_0004"
down_revision: str | None = "20260226_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

purchase_order_status_enum = sa.Enum(
    "DRAFT",
    "APPROVED",
    "PARTIALLY_RECEIVED",
    "CLOSED",
    "CANCELLED",
    name="purchase_order_status_enum",
)

grn_status_enum = sa.Enum(
    "DRAFT",
    "POSTED",
    "CANCELLED",
    name="grn_status_enum",
)


def upgrade() -> None:
    bind = op.get_bind()
    purchase_order_status_enum.create(bind, checkfirst=True)
    grn_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "purchase_orders",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("po_number", sa.String(length=60), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("status", purchase_order_status_enum, nullable=False),
        sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column("expected_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["supplier_id"], ["parties.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("po_number"),
    )
    op.create_index(op.f("ix_purchase_orders_id"), "purchase_orders", ["id"], unique=False)
    op.create_index(
        op.f("ix_purchase_orders_po_number"),
        "purchase_orders",
        ["po_number"],
        unique=True,
    )
    op.create_index(
        "ix_purchase_orders_supplier_id", "purchase_orders", ["supplier_id"], unique=False
    )
    op.create_index(
        "ix_purchase_orders_warehouse_id", "purchase_orders", ["warehouse_id"], unique=False
    )
    op.create_index("ix_purchase_orders_status", "purchase_orders", ["status"], unique=False)

    op.create_table(
        "purchase_order_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("purchase_order_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("ordered_qty", sa.Numeric(precision=18, scale=3), nullable=False),
        sa.Column(
            "received_qty", sa.Numeric(precision=18, scale=3), nullable=False, server_default="0"
        ),
        sa.Column("unit_cost", sa.Numeric(precision=14, scale=4), nullable=True),
        sa.Column(
            "free_qty", sa.Numeric(precision=18, scale=3), nullable=False, server_default="0"
        ),
        sa.Column("line_notes", sa.Text(), nullable=True),
        sa.CheckConstraint("ordered_qty > 0", name="ck_po_line_ordered_qty_gt_zero"),
        sa.CheckConstraint("received_qty >= 0", name="ck_po_line_received_qty_non_negative"),
        sa.CheckConstraint("free_qty >= 0", name="ck_po_line_free_qty_non_negative"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["purchase_order_id"], ["purchase_orders.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_purchase_order_lines_id"),
        "purchase_order_lines",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_purchase_order_lines_purchase_order_id",
        "purchase_order_lines",
        ["purchase_order_id"],
        unique=False,
    )

    op.create_table(
        "grns",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("grn_number", sa.String(length=60), nullable=False),
        sa.Column("purchase_order_id", sa.Integer(), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("status", grn_status_enum, nullable=False),
        sa.Column("received_date", sa.Date(), nullable=False),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("posted_by", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["posted_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["purchase_order_id"], ["purchase_orders.id"]),
        sa.ForeignKeyConstraint(["supplier_id"], ["parties.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("grn_number"),
    )
    op.create_index(op.f("ix_grns_id"), "grns", ["id"], unique=False)
    op.create_index(op.f("ix_grns_grn_number"), "grns", ["grn_number"], unique=True)
    op.create_index("ix_grns_purchase_order_id", "grns", ["purchase_order_id"], unique=False)
    op.create_index("ix_grns_supplier_id", "grns", ["supplier_id"], unique=False)
    op.create_index("ix_grns_warehouse_id", "grns", ["warehouse_id"], unique=False)
    op.create_index("ix_grns_status", "grns", ["status"], unique=False)

    op.create_table(
        "grn_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("grn_id", sa.Integer(), nullable=False),
        sa.Column("po_line_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("received_qty", sa.Numeric(precision=18, scale=3), nullable=False),
        sa.Column(
            "free_qty", sa.Numeric(precision=18, scale=3), nullable=False, server_default="0"
        ),
        sa.Column("unit_cost", sa.Numeric(precision=14, scale=4), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=False),
        sa.CheckConstraint("received_qty > 0", name="ck_grn_line_received_qty_gt_zero"),
        sa.CheckConstraint("free_qty >= 0", name="ck_grn_line_free_qty_non_negative"),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"]),
        sa.ForeignKeyConstraint(["grn_id"], ["grns.id"]),
        sa.ForeignKeyConstraint(["po_line_id"], ["purchase_order_lines.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_grn_lines_id"), "grn_lines", ["id"], unique=False)
    op.create_index(op.f("ix_grn_lines_grn_id"), "grn_lines", ["grn_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_grn_lines_grn_id"), table_name="grn_lines")
    op.drop_index(op.f("ix_grn_lines_id"), table_name="grn_lines")
    op.drop_table("grn_lines")

    op.drop_index("ix_grns_status", table_name="grns")
    op.drop_index("ix_grns_warehouse_id", table_name="grns")
    op.drop_index("ix_grns_supplier_id", table_name="grns")
    op.drop_index("ix_grns_purchase_order_id", table_name="grns")
    op.drop_index(op.f("ix_grns_grn_number"), table_name="grns")
    op.drop_index(op.f("ix_grns_id"), table_name="grns")
    op.drop_table("grns")

    op.drop_index("ix_purchase_order_lines_purchase_order_id", table_name="purchase_order_lines")
    op.drop_index(op.f("ix_purchase_order_lines_id"), table_name="purchase_order_lines")
    op.drop_table("purchase_order_lines")

    op.drop_index("ix_purchase_orders_status", table_name="purchase_orders")
    op.drop_index("ix_purchase_orders_warehouse_id", table_name="purchase_orders")
    op.drop_index("ix_purchase_orders_supplier_id", table_name="purchase_orders")
    op.drop_index(op.f("ix_purchase_orders_po_number"), table_name="purchase_orders")
    op.drop_index(op.f("ix_purchase_orders_id"), table_name="purchase_orders")
    op.drop_table("purchase_orders")

    bind = op.get_bind()
    grn_status_enum.drop(bind, checkfirst=True)
    purchase_order_status_enum.drop(bind, checkfirst=True)
