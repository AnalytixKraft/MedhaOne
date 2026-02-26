"""add inventory core schema

Revision ID: 20260226_0002
Revises: 20260225_0001
Create Date: 2026-02-26 10:40:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260226_0002"
down_revision: str | None = "20260225_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

party_type_enum = sa.Enum(
    "MANUFACTURER",
    "SUPER_STOCKIST",
    "DISTRIBUTOR",
    "HOSPITAL",
    "PHARMACY",
    "RETAILER",
    "CONSUMER",
    name="party_type_enum",
)

inventory_txn_type_enum = sa.Enum(
    "IN",
    "OUT",
    "ADJUST",
    "TRANSFER",
    name="inventory_txn_type_enum",
)

inventory_reason_enum = sa.Enum(
    "PURCHASE_GRN",
    "SALES_DISPATCH",
    "STOCK_ADJUSTMENT",
    "OPENING_STOCK",
    name="inventory_reason_enum",
)


def upgrade() -> None:
    bind = op.get_bind()
    party_type_enum.create(bind, checkfirst=True)
    inventory_txn_type_enum.create(bind, checkfirst=True)
    inventory_reason_enum.create(bind, checkfirst=True)

    op.create_table(
        "parties",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("party_type", party_type_enum, nullable=False),
        sa.Column("phone", sa.String(length=30), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_parties_id"), "parties", ["id"], unique=False)

    op.create_table(
        "warehouses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index(op.f("ix_warehouses_code"), "warehouses", ["code"], unique=True)
    op.create_index(op.f("ix_warehouses_id"), "warehouses", ["id"], unique=False)

    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sku", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("brand", sa.String(length=120), nullable=True),
        sa.Column("uom", sa.String(length=30), nullable=False),
        sa.Column("barcode", sa.String(length=120), nullable=True),
        sa.Column("hsn", sa.String(length=50), nullable=True),
        sa.Column("gst_rate", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sku"),
    )
    op.create_index(op.f("ix_products_id"), "products", ["id"], unique=False)
    op.create_index(op.f("ix_products_sku"), "products", ["sku"], unique=True)

    op.create_table(
        "batches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("batch_no", sa.String(length=100), nullable=False),
        sa.Column("expiry_date", sa.Date(), nullable=False),
        sa.Column("mfg_date", sa.Date(), nullable=True),
        sa.Column("mrp", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "product_id", "batch_no", "expiry_date", name="uq_batch_product_no_expiry"
        ),
    )
    op.create_index(op.f("ix_batches_id"), "batches", ["id"], unique=False)
    op.create_index(op.f("ix_batches_product_id"), "batches", ["product_id"], unique=False)

    op.create_table(
        "inventory_ledger",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("txn_type", inventory_txn_type_enum, nullable=False),
        sa.Column("reason", inventory_reason_enum, nullable=False),
        sa.Column("ref_type", sa.String(length=50), nullable=True),
        sa.Column("ref_id", sa.String(length=100), nullable=True),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("qty", sa.Numeric(precision=18, scale=3), nullable=False),
        sa.Column("unit_cost", sa.Numeric(precision=14, scale=4), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_inventory_ledger_id"), "inventory_ledger", ["id"], unique=False)
    op.create_index("ix_inventory_ledger_batch_id", "inventory_ledger", ["batch_id"], unique=False)
    op.create_index(
        "ix_inventory_ledger_created_at", "inventory_ledger", ["created_at"], unique=False
    )
    op.create_index(
        "ix_inventory_ledger_wh_prod",
        "inventory_ledger",
        ["warehouse_id", "product_id"],
        unique=False,
    )

    op.create_table(
        "stock_summary",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column(
            "qty_on_hand", sa.Numeric(precision=18, scale=3), nullable=False, server_default="0"
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "warehouse_id",
            "product_id",
            "batch_id",
            name="uq_stock_summary_wh_product_batch",
        ),
    )
    op.create_index(op.f("ix_stock_summary_id"), "stock_summary", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_stock_summary_id"), table_name="stock_summary")
    op.drop_table("stock_summary")

    op.drop_index("ix_inventory_ledger_wh_prod", table_name="inventory_ledger")
    op.drop_index("ix_inventory_ledger_created_at", table_name="inventory_ledger")
    op.drop_index("ix_inventory_ledger_batch_id", table_name="inventory_ledger")
    op.drop_index(op.f("ix_inventory_ledger_id"), table_name="inventory_ledger")
    op.drop_table("inventory_ledger")

    op.drop_index(op.f("ix_batches_product_id"), table_name="batches")
    op.drop_index(op.f("ix_batches_id"), table_name="batches")
    op.drop_table("batches")

    op.drop_index(op.f("ix_products_sku"), table_name="products")
    op.drop_index(op.f("ix_products_id"), table_name="products")
    op.drop_table("products")

    op.drop_index(op.f("ix_warehouses_id"), table_name="warehouses")
    op.drop_index(op.f("ix_warehouses_code"), table_name="warehouses")
    op.drop_table("warehouses")

    op.drop_index(op.f("ix_parties_id"), table_name="parties")
    op.drop_table("parties")

    bind = op.get_bind()
    inventory_reason_enum.drop(bind, checkfirst=True)
    inventory_txn_type_enum.drop(bind, checkfirst=True)
    party_type_enum.drop(bind, checkfirst=True)
