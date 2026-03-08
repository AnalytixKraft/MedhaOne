"""add pan number to company settings

Revision ID: 20260308_0019
Revises: 20260308_0018
Create Date: 2026-03-08 18:10:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260308_0019"
down_revision: str | None = "20260308_0018"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("company_settings", sa.Column("pan_number", sa.String(length=10), nullable=True))
    op.execute(
        """
        UPDATE company_settings
        SET pan_number = SUBSTRING(UPPER(gst_number) FROM 3 FOR 10)
        WHERE gst_number IS NOT NULL
          AND UPPER(gst_number) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]{3}$'
        """
    )


def downgrade() -> None:
    op.drop_column("company_settings", "pan_number")
