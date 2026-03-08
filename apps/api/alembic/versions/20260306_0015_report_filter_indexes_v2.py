"""add filter indexes for reporting

Revision ID: 20260306_0015
Revises: 20260306_0014
Create Date: 2026-03-06 21:05:00
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260306_0015"
down_revision: str | None = "20260306_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Use IF NOT EXISTS because tenant schema migrations may be re-run in
    # partially seeded environments.
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_brand ON products (brand)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_hsn ON products (hsn)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_batches_batch_no ON batches (batch_no)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_batches_batch_no")
    op.execute("DROP INDEX IF EXISTS ix_products_hsn")
    op.execute("DROP INDEX IF EXISTS ix_products_brand")
