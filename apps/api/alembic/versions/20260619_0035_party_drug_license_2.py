"""add second drug licence fields on parties

Revision ID: 20260619_0035
Revises: 20260618_0034
Create Date: 2026-06-19 00:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

revision = "20260619_0035"
down_revision = "20260618_0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("parties", sa.Column("drug_license_2_number", sa.String(120), nullable=True))
    op.add_column(
        "parties",
        sa.Column(
            "drug_license_2_verified_status",
            sa.String(32),
            nullable=False,
            server_default="NOT_VERIFIED",
        ),
    )
    op.add_column(
        "parties",
        sa.Column("drug_license_2_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "parties",
        sa.Column(
            "drug_license_2_verified_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True
        ),
    )
    op.add_column(
        "parties", sa.Column("drug_license_2_verification_source", sa.String(255), nullable=True)
    )
    op.add_column("parties", sa.Column("drug_license_2_holder_name", sa.String(255), nullable=True))
    op.add_column("parties", sa.Column("drug_license_2_valid_upto", sa.Date(), nullable=True))
    op.add_column("parties", sa.Column("drug_license_2_state", sa.String(120), nullable=True))
    op.add_column("parties", sa.Column("drug_license_2_raw_snapshot", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("parties", "drug_license_2_raw_snapshot")
    op.drop_column("parties", "drug_license_2_state")
    op.drop_column("parties", "drug_license_2_valid_upto")
    op.drop_column("parties", "drug_license_2_holder_name")
    op.drop_column("parties", "drug_license_2_verification_source")
    op.drop_column("parties", "drug_license_2_verified_by")
    op.drop_column("parties", "drug_license_2_verified_at")
    op.drop_column("parties", "drug_license_2_verified_status")
    op.drop_column("parties", "drug_license_2_number")
