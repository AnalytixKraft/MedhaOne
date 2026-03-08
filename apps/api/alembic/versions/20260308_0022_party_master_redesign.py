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


def upgrade() -> None:
    op.add_column("parties", sa.Column("party_code", sa.String(length=60), nullable=True))
    op.add_column("parties", sa.Column("display_name", sa.String(length=255), nullable=True))
    op.add_column("parties", sa.Column("party_category", sa.String(length=30), nullable=True))
    op.add_column("parties", sa.Column("contact_person", sa.String(length=255), nullable=True))
    op.add_column("parties", sa.Column("designation", sa.String(length=120), nullable=True))
    op.add_column("parties", sa.Column("whatsapp_no", sa.String(length=30), nullable=True))
    op.add_column("parties", sa.Column("office_phone", sa.String(length=30), nullable=True))
    op.add_column("parties", sa.Column("website", sa.String(length=255), nullable=True))
    op.add_column("parties", sa.Column("address_line_2", sa.Text(), nullable=True))
    op.add_column("parties", sa.Column("country", sa.String(length=120), nullable=True, server_default="India"))
    op.add_column("parties", sa.Column("registration_type", sa.String(length=30), nullable=True))
    op.add_column("parties", sa.Column("drug_license_number", sa.String(length=120), nullable=True))
    op.add_column("parties", sa.Column("fssai_number", sa.String(length=120), nullable=True))
    op.add_column("parties", sa.Column("udyam_number", sa.String(length=120), nullable=True))
    op.add_column("parties", sa.Column("credit_limit", sa.Numeric(14, 2), nullable=True, server_default="0"))
    op.add_column("parties", sa.Column("payment_terms", sa.String(length=255), nullable=True))
    op.add_column("parties", sa.Column("opening_balance", sa.Numeric(14, 2), nullable=True, server_default="0"))
    op.add_column("parties", sa.Column("outstanding_tracking_mode", sa.String(length=30), nullable=True, server_default="BILL_WISE"))

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

    op.drop_column("parties", "outstanding_tracking_mode")
    op.drop_column("parties", "opening_balance")
    op.drop_column("parties", "payment_terms")
    op.drop_column("parties", "credit_limit")
    op.drop_column("parties", "udyam_number")
    op.drop_column("parties", "fssai_number")
    op.drop_column("parties", "drug_license_number")
    op.drop_column("parties", "registration_type")
    op.drop_column("parties", "country")
    op.drop_column("parties", "address_line_2")
    op.drop_column("parties", "website")
    op.drop_column("parties", "office_phone")
    op.drop_column("parties", "whatsapp_no")
    op.drop_column("parties", "designation")
    op.drop_column("parties", "contact_person")
    op.drop_column("parties", "party_category")
    op.drop_column("parties", "display_name")
    op.drop_column("parties", "party_code")
