"""redesign ledger master into party master

Revision ID: 20260308_0022
Revises: 20260308_0021
Create Date: 2026-03-08 16:35:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260308_0022"
down_revision: str | None = "20260308_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _existing_columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    existing_columns = _existing_columns("parties")
    for column in [
        sa.Column("party_code", sa.String(length=60), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("party_category", sa.String(length=30), nullable=True),
        sa.Column("contact_person", sa.String(length=255), nullable=True),
        sa.Column("designation", sa.String(length=120), nullable=True),
        sa.Column("whatsapp_no", sa.String(length=30), nullable=True),
        sa.Column("office_phone", sa.String(length=30), nullable=True),
        sa.Column("website", sa.String(length=255), nullable=True),
        sa.Column("address_line_2", sa.Text(), nullable=True),
        sa.Column("country", sa.String(length=120), nullable=True, server_default="India"),
        sa.Column("registration_type", sa.String(length=30), nullable=True),
        sa.Column("drug_license_number", sa.String(length=120), nullable=True),
        sa.Column("fssai_number", sa.String(length=120), nullable=True),
        sa.Column("udyam_number", sa.String(length=120), nullable=True),
        sa.Column("credit_limit", sa.Numeric(14, 2), nullable=True, server_default="0"),
        sa.Column("payment_terms", sa.String(length=255), nullable=True),
        sa.Column("opening_balance", sa.Numeric(14, 2), nullable=True, server_default="0"),
        sa.Column("outstanding_tracking_mode", sa.String(length=30), nullable=True, server_default="BILL_WISE"),
    ]:
        if column.name not in existing_columns:
            op.add_column("parties", column)
            existing_columns.add(column.name)

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE parties ALTER COLUMN party_type TYPE TEXT USING party_type::text")
        op.execute(
            """
            UPDATE parties
            SET party_category = CASE party_type
                WHEN 'DISTRIBUTOR' THEN 'DISTRIBUTOR'
                WHEN 'SUPER_STOCKIST' THEN 'STOCKIST'
                WHEN 'HOSPITAL' THEN 'HOSPITAL'
                WHEN 'PHARMACY' THEN 'PHARMACY'
                WHEN 'RETAILER' THEN 'RETAILER'
                WHEN 'MANUFACTURER' THEN 'OTHER'
                WHEN 'CONSUMER' THEN 'OTHER'
                ELSE party_category
            END
            WHERE party_category IS NULL
            """
        )
        op.execute(
            """
            UPDATE parties
            SET party_type = CASE party_type
                WHEN 'DISTRIBUTOR' THEN 'SUPPLIER'
                WHEN 'SUPER_STOCKIST' THEN 'SUPPLIER'
                WHEN 'MANUFACTURER' THEN 'SUPPLIER'
                WHEN 'HOSPITAL' THEN 'CUSTOMER'
                WHEN 'PHARMACY' THEN 'CUSTOMER'
                WHEN 'RETAILER' THEN 'CUSTOMER'
                WHEN 'CONSUMER' THEN 'CUSTOMER'
                ELSE party_type
            END
            """
        )
        op.execute("DROP TYPE IF EXISTS party_type_enum")
    else:
        with op.batch_alter_table("parties") as batch_op:
            batch_op.alter_column("party_type", existing_type=sa.String(length=30), type_=sa.String(length=30))
        op.execute(
            """
            UPDATE parties
            SET party_category = CASE party_type
                WHEN 'DISTRIBUTOR' THEN 'DISTRIBUTOR'
                WHEN 'SUPER_STOCKIST' THEN 'STOCKIST'
                WHEN 'HOSPITAL' THEN 'HOSPITAL'
                WHEN 'PHARMACY' THEN 'PHARMACY'
                WHEN 'RETAILER' THEN 'RETAILER'
                WHEN 'MANUFACTURER' THEN 'OTHER'
                WHEN 'CONSUMER' THEN 'OTHER'
                ELSE party_category
            END
            WHERE party_category IS NULL
            """
        )
        op.execute(
            """
            UPDATE parties
            SET party_type = CASE party_type
                WHEN 'DISTRIBUTOR' THEN 'SUPPLIER'
                WHEN 'SUPER_STOCKIST' THEN 'SUPPLIER'
                WHEN 'MANUFACTURER' THEN 'SUPPLIER'
                WHEN 'HOSPITAL' THEN 'CUSTOMER'
                WHEN 'PHARMACY' THEN 'CUSTOMER'
                WHEN 'RETAILER' THEN 'CUSTOMER'
                WHEN 'CONSUMER' THEN 'CUSTOMER'
                ELSE party_type
            END
            """
        )

    op.execute("UPDATE parties SET country = COALESCE(country, 'India')")
    op.execute(
        "UPDATE parties SET outstanding_tracking_mode = COALESCE(outstanding_tracking_mode, 'BILL_WISE')"
    )
    op.execute(
        "UPDATE parties SET registration_type = CASE WHEN gstin IS NOT NULL AND registration_type IS NULL THEN 'REGISTERED' ELSE registration_type END"
    )


def downgrade() -> None:
    bind = op.get_bind()
    existing_columns = _existing_columns("parties")
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'party_type_enum') THEN
                CREATE TYPE party_type_enum AS ENUM (
                  'MANUFACTURER',
                  'SUPER_STOCKIST',
                  'DISTRIBUTOR',
                  'HOSPITAL',
                  'PHARMACY',
                  'RETAILER',
                  'CONSUMER'
                );
              END IF;
            END $$;
            """
        )
        op.execute(
            """
            UPDATE parties
            SET party_type = CASE
                WHEN party_type = 'SUPPLIER' AND party_category = 'DISTRIBUTOR' THEN 'DISTRIBUTOR'
                WHEN party_type = 'SUPPLIER' AND party_category = 'STOCKIST' THEN 'SUPER_STOCKIST'
                WHEN party_type = 'SUPPLIER' THEN 'MANUFACTURER'
                WHEN party_type = 'CUSTOMER' AND party_category = 'HOSPITAL' THEN 'HOSPITAL'
                WHEN party_type = 'CUSTOMER' AND party_category = 'PHARMACY' THEN 'PHARMACY'
                WHEN party_type = 'CUSTOMER' AND party_category = 'RETAILER' THEN 'RETAILER'
                ELSE 'CONSUMER'
            END
            """
        )
        op.execute("ALTER TABLE parties ALTER COLUMN party_type TYPE party_type_enum USING party_type::party_type_enum")

    for column_name in [
        "outstanding_tracking_mode",
        "opening_balance",
        "payment_terms",
        "credit_limit",
        "udyam_number",
        "fssai_number",
        "drug_license_number",
        "registration_type",
        "country",
        "address_line_2",
        "website",
        "office_phone",
        "whatsapp_no",
        "designation",
        "contact_person",
        "party_category",
        "display_name",
        "party_code",
    ]:
        if column_name in existing_columns:
            op.drop_column("parties", column_name)
