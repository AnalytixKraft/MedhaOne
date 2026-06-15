"""make drug_license_verification_logs.party_id nullable

Revision ID: 20260312_0031
Revises: 20260312_0030
Create Date: 2026-03-12 18:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "20260312_0031"
down_revision = "20260312_0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "drug_license_verification_logs",
        "party_id",
        existing_type=sa.Integer(),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "drug_license_verification_logs",
        "party_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
