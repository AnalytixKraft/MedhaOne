"""add purchase bill module with attachments and extraction status

Revision ID: 20260308_0021
Revises: 20260308_0020
Create Date: 2026-03-08 12:05:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260308_0021"
down_revision: str | None = "20260308_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()

    purchase_bill_status = postgresql.ENUM(
        "DRAFT",
        "VERIFIED",
        "POSTED",
        "CANCELLED",
        name="purchase_bill_status_enum",
    )
    purchase_bill_extraction_status = postgresql.ENUM(
        "NOT_STARTED",
        "EXTRACTED",
        "REVIEWED",
        "FAILED",
        name="purchase_bill_extraction_status_enum",
    )
    purchase_bill_status.create(bind, checkfirst=True)
    purchase_bill_extraction_status.create(bind, checkfirst=True)

    purchase_bill_status_ref = postgresql.ENUM(
        name="purchase_bill_status_enum",
        create_type=False,
    )
    purchase_bill_extraction_status_ref = postgresql.ENUM(
        name="purchase_bill_extraction_status_enum",
        create_type=False,
    )

    op.create_table(
        "document_attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("entity_type", sa.String(length=50), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_type", sa.String(length=100), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_document_attachments_id", "document_attachments", ["id"], unique=False)
    op.create_index(
        "ix_document_attachments_entity",
        "document_attachments",
        ["entity_type", "entity_id"],
        unique=False,
    )

    op.create_table(
        "purchase_bills",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("bill_number", sa.String(length=120), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=True),
        sa.Column("supplier_name_raw", sa.String(length=255), nullable=True),
        sa.Column("supplier_gstin", sa.String(length=20), nullable=True),
        sa.Column("bill_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("warehouse_id", sa.Integer(), nullable=True),
        sa.Column("status", purchase_bill_status_ref, nullable=False),
        sa.Column("subtotal", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("discount_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("taxable_value", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("cgst_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("sgst_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("igst_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("adjustment", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("extraction_status", purchase_bill_extraction_status_ref, nullable=False),
        sa.Column("extraction_confidence", sa.Numeric(5, 2), nullable=True),
        sa.Column("attachment_id", sa.Integer(), nullable=True),
        sa.Column("purchase_order_id", sa.Integer(), nullable=True),
        sa.Column("grn_id", sa.Integer(), nullable=True),
        sa.Column("extracted_json", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.CheckConstraint("subtotal >= 0", name="ck_purchase_bills_subtotal_non_negative"),
        sa.CheckConstraint("discount_amount >= 0", name="ck_purchase_bills_discount_non_negative"),
        sa.CheckConstraint("taxable_value >= 0", name="ck_purchase_bills_taxable_non_negative"),
        sa.CheckConstraint("cgst_amount >= 0", name="ck_purchase_bills_cgst_non_negative"),
        sa.CheckConstraint("sgst_amount >= 0", name="ck_purchase_bills_sgst_non_negative"),
        sa.CheckConstraint("igst_amount >= 0", name="ck_purchase_bills_igst_non_negative"),
        sa.CheckConstraint("total >= 0", name="ck_purchase_bills_total_non_negative"),
        sa.ForeignKeyConstraint(["attachment_id"], ["document_attachments.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["grn_id"], ["grns.id"]),
        sa.ForeignKeyConstraint(["purchase_order_id"], ["purchase_orders.id"]),
        sa.ForeignKeyConstraint(["supplier_id"], ["parties.id"]),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_purchase_bills_id", "purchase_bills", ["id"], unique=False)
    op.create_index("ix_purchase_bills_bill_number", "purchase_bills", ["bill_number"], unique=False)
    op.create_index("ix_purchase_bills_supplier_id", "purchase_bills", ["supplier_id"], unique=False)
    op.create_index("ix_purchase_bills_status", "purchase_bills", ["status"], unique=False)
    op.create_index("ix_purchase_bills_bill_date", "purchase_bills", ["bill_date"], unique=False)

    op.create_table(
        "purchase_bill_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("purchase_bill_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=True),
        sa.Column("description_raw", sa.Text(), nullable=False),
        sa.Column("hsn_code", sa.String(length=30), nullable=True),
        sa.Column("qty", sa.Numeric(18, 3), nullable=False, server_default="0"),
        sa.Column("unit", sa.String(length=20), nullable=True),
        sa.Column("unit_price", sa.Numeric(14, 4), nullable=False, server_default="0"),
        sa.Column("discount_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("gst_percent", sa.Numeric(7, 2), nullable=False, server_default="0"),
        sa.Column("line_total", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("batch_no", sa.String(length=80), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("confidence_score", sa.Numeric(5, 2), nullable=True),
        sa.CheckConstraint("qty >= 0", name="ck_purchase_bill_lines_qty_non_negative"),
        sa.CheckConstraint("unit_price >= 0", name="ck_purchase_bill_lines_unit_price_non_negative"),
        sa.CheckConstraint("discount_amount >= 0", name="ck_purchase_bill_lines_discount_non_negative"),
        sa.CheckConstraint("gst_percent >= 0", name="ck_purchase_bill_lines_gst_non_negative"),
        sa.CheckConstraint("line_total >= 0", name="ck_purchase_bill_lines_total_non_negative"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["purchase_bill_id"], ["purchase_bills.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_purchase_bill_lines_id", "purchase_bill_lines", ["id"], unique=False)
    op.create_index(
        "ix_purchase_bill_lines_purchase_bill_id",
        "purchase_bill_lines",
        ["purchase_bill_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_purchase_bill_lines_purchase_bill_id", table_name="purchase_bill_lines")
    op.drop_index("ix_purchase_bill_lines_id", table_name="purchase_bill_lines")
    op.drop_table("purchase_bill_lines")

    op.drop_index("ix_purchase_bills_bill_date", table_name="purchase_bills")
    op.drop_index("ix_purchase_bills_status", table_name="purchase_bills")
    op.drop_index("ix_purchase_bills_supplier_id", table_name="purchase_bills")
    op.drop_index("ix_purchase_bills_bill_number", table_name="purchase_bills")
    op.drop_index("ix_purchase_bills_id", table_name="purchase_bills")
    op.drop_table("purchase_bills")

    op.drop_index("ix_document_attachments_entity", table_name="document_attachments")
    op.drop_index("ix_document_attachments_id", table_name="document_attachments")
    op.drop_table("document_attachments")

    bind = op.get_bind()
    postgresql.ENUM(name="purchase_bill_extraction_status_enum").drop(bind, checkfirst=True)
    postgresql.ENUM(name="purchase_bill_status_enum").drop(bind, checkfirst=True)
