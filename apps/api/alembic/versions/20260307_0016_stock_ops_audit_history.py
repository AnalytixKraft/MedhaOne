"""separate stock operations and enhance audit trail

Revision ID: 20260307_0016
Revises: 20260306_0015
Create Date: 2026-03-07 11:20:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260307_0016"
down_revision: str | None = "20260306_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE inventory_reason_enum ADD VALUE IF NOT EXISTS 'STOCK_CORRECTION_OUT'")
        op.execute("ALTER TYPE inventory_reason_enum ADD VALUE IF NOT EXISTS 'STOCK_CORRECTION_IN'")

    stock_adjustment_type_enum_values = ("POSITIVE", "NEGATIVE")
    stock_adjustment_reason_enum_values = (
        "STOCK_COUNT_CORRECTION",
        "DAMAGED",
        "EXPIRED",
        "FOUND_STOCK",
        "OPENING_BALANCE_FIX",
        "THEFT",
        "BREAKAGE",
        "OTHER",
    )

    stock_adjustment_type_enum_create = postgresql.ENUM(
        *stock_adjustment_type_enum_values,
        name="stock_adjustment_type_enum",
    )
    stock_adjustment_reason_enum_create = postgresql.ENUM(
        *stock_adjustment_reason_enum_values,
        name="stock_adjustment_reason_enum",
    )
    stock_adjustment_type_enum_create.create(bind, checkfirst=True)
    stock_adjustment_reason_enum_create.create(bind, checkfirst=True)

    stock_adjustment_type_enum = postgresql.ENUM(
        *stock_adjustment_type_enum_values,
        name="stock_adjustment_type_enum",
        create_type=False,
    )
    stock_adjustment_reason_enum = postgresql.ENUM(
        *stock_adjustment_reason_enum_values,
        name="stock_adjustment_reason_enum",
        create_type=False,
    )

    op.add_column("batches", sa.Column("reference_id", sa.String(length=120), nullable=True))
    op.create_index("ix_batches_reference_id", "batches", ["reference_id"], unique=False)
    op.drop_constraint("uq_batch_product_no_expiry", "batches", type_="unique")
    op.create_unique_constraint(
        "uq_batch_product_metadata",
        "batches",
        ["product_id", "batch_no", "expiry_date", "mfg_date", "mrp", "reference_id"],
    )

    op.add_column("audit_logs", sa.Column("module", sa.String(length=64), nullable=True))
    op.add_column("audit_logs", sa.Column("summary", sa.String(length=255), nullable=True))
    op.add_column("audit_logs", sa.Column("reason", sa.String(length=120), nullable=True))
    op.add_column("audit_logs", sa.Column("remarks", sa.Text(), nullable=True))
    op.add_column("audit_logs", sa.Column("source_screen", sa.String(length=120), nullable=True))
    op.add_column("audit_logs", sa.Column("source_reference", sa.String(length=120), nullable=True))
    op.add_column("audit_logs", sa.Column("before_snapshot", sa.JSON(), nullable=True))
    op.add_column("audit_logs", sa.Column("after_snapshot", sa.JSON(), nullable=True))
    op.execute(
        """
        UPDATE audit_logs
        SET module = CASE
            WHEN entity_type IN ('PO', 'GRN', 'PURCHASE_RETURN', 'PURCHASE_CREDIT_NOTE') THEN 'Purchase'
            WHEN entity_type = 'COMPANY_SETTINGS' THEN 'Settings'
            ELSE 'Inventory'
        END
        WHERE module IS NULL
        """
    )
    op.alter_column("audit_logs", "module", nullable=False)
    op.create_index("ix_audit_logs_module", "audit_logs", ["module"], unique=False)

    op.create_table(
        "stock_corrections",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("reference_id", sa.String(length=120), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("source_batch_id", sa.Integer(), nullable=False),
        sa.Column("corrected_batch_id", sa.Integer(), nullable=False),
        sa.Column("qty", sa.Numeric(18, 3), nullable=False),
        sa.Column("reason", sa.String(length=120), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("out_ledger_id", sa.Integer(), nullable=True),
        sa.Column("in_ledger_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["corrected_batch_id"], ["batches.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["in_ledger_id"], ["inventory_ledger.id"]),
        sa.ForeignKeyConstraint(["out_ledger_id"], ["inventory_ledger.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["source_batch_id"], ["batches.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_stock_corrections_id", "stock_corrections", ["id"], unique=False)
    op.create_index("ix_stock_corrections_created_at", "stock_corrections", ["created_at"], unique=False)
    op.create_index("ix_stock_corrections_product", "stock_corrections", ["product_id"], unique=False)
    op.create_index("ix_stock_corrections_reference_id", "stock_corrections", ["reference_id"], unique=True)
    op.create_index("ix_stock_corrections_warehouse", "stock_corrections", ["warehouse_id"], unique=False)

    op.create_table(
        "stock_adjustments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("reference_id", sa.String(length=120), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("adjustment_type", stock_adjustment_type_enum, nullable=False),
        sa.Column("qty", sa.Numeric(18, 3), nullable=False),
        sa.Column("reason", stock_adjustment_reason_enum, nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("before_qty", sa.Numeric(18, 3), nullable=False),
        sa.Column("after_qty", sa.Numeric(18, 3), nullable=False),
        sa.Column("ledger_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["ledger_id"], ["inventory_ledger.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_stock_adjustments_id", "stock_adjustments", ["id"], unique=False)
    op.create_index("ix_stock_adjustments_created_at", "stock_adjustments", ["created_at"], unique=False)
    op.create_index("ix_stock_adjustments_product", "stock_adjustments", ["product_id"], unique=False)
    op.create_index("ix_stock_adjustments_reference_id", "stock_adjustments", ["reference_id"], unique=True)
    op.create_index("ix_stock_adjustments_warehouse", "stock_adjustments", ["warehouse_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_stock_adjustments_warehouse", table_name="stock_adjustments")
    op.drop_index("ix_stock_adjustments_reference_id", table_name="stock_adjustments")
    op.drop_index("ix_stock_adjustments_product", table_name="stock_adjustments")
    op.drop_index("ix_stock_adjustments_created_at", table_name="stock_adjustments")
    op.drop_index("ix_stock_adjustments_id", table_name="stock_adjustments")
    op.drop_table("stock_adjustments")

    op.drop_index("ix_stock_corrections_warehouse", table_name="stock_corrections")
    op.drop_index("ix_stock_corrections_reference_id", table_name="stock_corrections")
    op.drop_index("ix_stock_corrections_product", table_name="stock_corrections")
    op.drop_index("ix_stock_corrections_created_at", table_name="stock_corrections")
    op.drop_index("ix_stock_corrections_id", table_name="stock_corrections")
    op.drop_table("stock_corrections")

    op.drop_index("ix_audit_logs_module", table_name="audit_logs")
    op.drop_column("audit_logs", "after_snapshot")
    op.drop_column("audit_logs", "before_snapshot")
    op.drop_column("audit_logs", "source_reference")
    op.drop_column("audit_logs", "source_screen")
    op.drop_column("audit_logs", "remarks")
    op.drop_column("audit_logs", "reason")
    op.drop_column("audit_logs", "summary")
    op.drop_column("audit_logs", "module")

    op.drop_constraint("uq_batch_product_metadata", "batches", type_="unique")
    op.create_unique_constraint(
        "uq_batch_product_no_expiry",
        "batches",
        ["product_id", "batch_no", "expiry_date"],
    )
    op.drop_index("ix_batches_reference_id", table_name="batches")
    op.drop_column("batches", "reference_id")

    bind = op.get_bind()
    stock_adjustment_reason_enum = postgresql.ENUM(name="stock_adjustment_reason_enum")
    stock_adjustment_type_enum = postgresql.ENUM(name="stock_adjustment_type_enum")
    stock_adjustment_reason_enum.drop(bind, checkfirst=True)
    stock_adjustment_type_enum.drop(bind, checkfirst=True)
