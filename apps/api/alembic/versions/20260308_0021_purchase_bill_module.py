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


def _existing_tables() -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return set(inspector.get_table_names())


def _existing_indexes(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table_name) if index.get("name")}


def upgrade() -> None:
    bind = op.get_bind()
    existing_tables = _existing_tables()

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

    if "document_attachments" not in existing_tables:
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
        existing_tables.add("document_attachments")
    document_attachment_indexes = _existing_indexes("document_attachments")
    if "ix_document_attachments_id" not in document_attachment_indexes:
        op.create_index("ix_document_attachments_id", "document_attachments", ["id"], unique=False)
    if "ix_document_attachments_entity" not in document_attachment_indexes:
        op.create_index(
            "ix_document_attachments_entity",
            "document_attachments",
            ["entity_type", "entity_id"],
            unique=False,
        )

    if "purchase_bills" not in existing_tables:
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
        existing_tables.add("purchase_bills")
    purchase_bills_indexes = _existing_indexes("purchase_bills")
    for index_name, columns in [
        ("ix_purchase_bills_id", ["id"]),
        ("ix_purchase_bills_bill_number", ["bill_number"]),
        ("ix_purchase_bills_supplier_id", ["supplier_id"]),
        ("ix_purchase_bills_status", ["status"]),
        ("ix_purchase_bills_bill_date", ["bill_date"]),
    ]:
        if index_name not in purchase_bills_indexes:
            op.create_index(index_name, "purchase_bills", columns, unique=False)

    if "purchase_bill_lines" not in existing_tables:
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
        existing_tables.add("purchase_bill_lines")
    purchase_bill_line_indexes = _existing_indexes("purchase_bill_lines")
    if "ix_purchase_bill_lines_id" not in purchase_bill_line_indexes:
        op.create_index("ix_purchase_bill_lines_id", "purchase_bill_lines", ["id"], unique=False)
    if "ix_purchase_bill_lines_purchase_bill_id" not in purchase_bill_line_indexes:
        op.create_index(
            "ix_purchase_bill_lines_purchase_bill_id",
            "purchase_bill_lines",
            ["purchase_bill_id"],
            unique=False,
        )


def downgrade() -> None:
    existing_tables = _existing_tables()

    if "purchase_bill_lines" in existing_tables:
        purchase_bill_line_indexes = _existing_indexes("purchase_bill_lines")
        if "ix_purchase_bill_lines_purchase_bill_id" in purchase_bill_line_indexes:
            op.drop_index("ix_purchase_bill_lines_purchase_bill_id", table_name="purchase_bill_lines")
        if "ix_purchase_bill_lines_id" in purchase_bill_line_indexes:
            op.drop_index("ix_purchase_bill_lines_id", table_name="purchase_bill_lines")
        op.drop_table("purchase_bill_lines")

    if "purchase_bills" in existing_tables:
        purchase_bills_indexes = _existing_indexes("purchase_bills")
        for index_name in [
            "ix_purchase_bills_bill_date",
            "ix_purchase_bills_status",
            "ix_purchase_bills_supplier_id",
            "ix_purchase_bills_bill_number",
            "ix_purchase_bills_id",
        ]:
            if index_name in purchase_bills_indexes:
                op.drop_index(index_name, table_name="purchase_bills")
        op.drop_table("purchase_bills")

    if "document_attachments" in existing_tables:
        document_attachment_indexes = _existing_indexes("document_attachments")
        if "ix_document_attachments_entity" in document_attachment_indexes:
            op.drop_index("ix_document_attachments_entity", table_name="document_attachments")
        if "ix_document_attachments_id" in document_attachment_indexes:
            op.drop_index("ix_document_attachments_id", table_name="document_attachments")
        op.drop_table("document_attachments")

    bind = op.get_bind()
    postgresql.ENUM(name="purchase_bill_extraction_status_enum").drop(bind, checkfirst=True)
    postgresql.ENUM(name="purchase_bill_status_enum").drop(bind, checkfirst=True)
