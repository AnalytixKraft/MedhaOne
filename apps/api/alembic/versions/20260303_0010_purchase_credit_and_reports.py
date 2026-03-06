"""add purchase credit notes and reporting indexes

Revision ID: 20260303_0010
Revises: 20260301_0009
Create Date: 2026-03-03 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20260303_0010"
down_revision: str | None = "20260301_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

purchase_return_status_enum = postgresql.ENUM(
    "DRAFT",
    "POSTED",
    "CANCELLED",
    name="purchase_return_status_enum",
    create_type=False,
)

purchase_credit_note_status_enum = postgresql.ENUM(
    "GENERATED",
    "ADJUSTED",
    name="purchase_credit_note_status_enum",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    purchase_return_status_enum.create(bind, checkfirst=True)
    purchase_credit_note_status_enum.create(bind, checkfirst=True)

    op.create_table(
        "purchase_returns",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("return_number", sa.String(length=60), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("status", purchase_return_status_enum, nullable=False),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("posted_by", sa.Integer(), nullable=True),
        sa.Column(
            "created_by",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["posted_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["supplier_id"], ["parties.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("return_number"),
    )
    op.create_index(op.f("ix_purchase_returns_id"), "purchase_returns", ["id"], unique=False)
    op.create_index(
        op.f("ix_purchase_returns_return_number"),
        "purchase_returns",
        ["return_number"],
        unique=True,
    )
    op.create_index(
        "ix_purchase_returns_supplier_id",
        "purchase_returns",
        ["supplier_id"],
        unique=False,
    )
    op.create_index(
        "ix_purchase_returns_warehouse_id",
        "purchase_returns",
        ["warehouse_id"],
        unique=False,
    )
    op.create_index("ix_purchase_returns_status", "purchase_returns", ["status"], unique=False)
    op.create_index(
        "ix_purchase_returns_posted_at",
        "purchase_returns",
        ["posted_at"],
        unique=False,
    )

    op.create_table(
        "purchase_return_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("purchase_return_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("batch_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Numeric(precision=18, scale=3), nullable=False),
        sa.Column("unit_cost", sa.Numeric(precision=14, scale=4), nullable=False),
        sa.CheckConstraint(
            "quantity > 0",
            name="ck_purchase_return_line_quantity_gt_zero",
        ),
        sa.CheckConstraint(
            "unit_cost >= 0",
            name="ck_purchase_return_line_unit_cost_non_negative",
        ),
        sa.ForeignKeyConstraint(["batch_id"], ["batches.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["purchase_return_id"], ["purchase_returns.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_purchase_return_lines_id"),
        "purchase_return_lines",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_purchase_return_lines_purchase_return_id",
        "purchase_return_lines",
        ["purchase_return_id"],
        unique=False,
    )

    op.create_table(
        "purchase_credit_notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("credit_note_number", sa.String(length=60), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), nullable=False),
        sa.Column("purchase_return_id", sa.Integer(), nullable=False),
        sa.Column("total_amount", sa.Numeric(precision=18, scale=4), nullable=False),
        sa.Column("status", purchase_credit_note_status_enum, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["purchase_return_id"], ["purchase_returns.id"]),
        sa.ForeignKeyConstraint(["supplier_id"], ["parties.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("credit_note_number"),
        sa.UniqueConstraint("purchase_return_id"),
    )
    op.create_index(
        op.f("ix_purchase_credit_notes_id"),
        "purchase_credit_notes",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_purchase_credit_notes_credit_note_number"),
        "purchase_credit_notes",
        ["credit_note_number"],
        unique=True,
    )
    op.create_index(
        "ix_purchase_credit_notes_supplier_id",
        "purchase_credit_notes",
        ["supplier_id"],
        unique=False,
    )
    op.create_index(
        "ix_purchase_credit_notes_warehouse_id",
        "purchase_credit_notes",
        ["warehouse_id"],
        unique=False,
    )
    op.create_index(
        "ix_purchase_credit_notes_status",
        "purchase_credit_notes",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_purchase_credit_notes_created_at",
        "purchase_credit_notes",
        ["created_at"],
        unique=False,
    )

    op.create_index("ix_batches_expiry_date", "batches", ["expiry_date"], unique=False)
    op.create_index(
        "ix_stock_summary_wh_prod_qty",
        "stock_summary",
        ["warehouse_id", "product_id", "qty_on_hand"],
        unique=False,
    )
    op.create_index(
        "ix_inventory_ledger_wh_prod_batch_created",
        "inventory_ledger",
        ["warehouse_id", "product_id", "batch_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_inventory_ledger_wh_prod_batch_created",
        table_name="inventory_ledger",
    )
    op.drop_index("ix_stock_summary_wh_prod_qty", table_name="stock_summary")
    op.drop_index("ix_batches_expiry_date", table_name="batches")

    op.drop_index("ix_purchase_credit_notes_created_at", table_name="purchase_credit_notes")
    op.drop_index("ix_purchase_credit_notes_status", table_name="purchase_credit_notes")
    op.drop_index("ix_purchase_credit_notes_warehouse_id", table_name="purchase_credit_notes")
    op.drop_index("ix_purchase_credit_notes_supplier_id", table_name="purchase_credit_notes")
    op.drop_index(
        op.f("ix_purchase_credit_notes_credit_note_number"),
        table_name="purchase_credit_notes",
    )
    op.drop_index(op.f("ix_purchase_credit_notes_id"), table_name="purchase_credit_notes")
    op.drop_table("purchase_credit_notes")

    op.drop_index(
        "ix_purchase_return_lines_purchase_return_id",
        table_name="purchase_return_lines",
    )
    op.drop_index(op.f("ix_purchase_return_lines_id"), table_name="purchase_return_lines")
    op.drop_table("purchase_return_lines")

    op.drop_index("ix_purchase_returns_posted_at", table_name="purchase_returns")
    op.drop_index("ix_purchase_returns_status", table_name="purchase_returns")
    op.drop_index("ix_purchase_returns_warehouse_id", table_name="purchase_returns")
    op.drop_index("ix_purchase_returns_supplier_id", table_name="purchase_returns")
    op.drop_index(op.f("ix_purchase_returns_return_number"), table_name="purchase_returns")
    op.drop_index(op.f("ix_purchase_returns_id"), table_name="purchase_returns")
    op.drop_table("purchase_returns")

    bind = op.get_bind()
    purchase_credit_note_status_enum.drop(bind, checkfirst=True)
    purchase_return_status_enum.drop(bind, checkfirst=True)
