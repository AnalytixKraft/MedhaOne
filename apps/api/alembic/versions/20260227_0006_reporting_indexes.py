"""add reporting indexes

Revision ID: 20260227_0006
Revises: 20260227_0005
Create Date: 2026-02-27 19:15:00
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260227_0006"
down_revision: str | None = "20260227_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_inventory_ledger_reason", "inventory_ledger", ["reason"], unique=False)
    op.create_index("ix_grns_posted_at", "grns", ["posted_at"], unique=False)
    op.create_index("ix_purchase_orders_order_date", "purchase_orders", ["order_date"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_purchase_orders_order_date", table_name="purchase_orders")
    op.drop_index("ix_grns_posted_at", table_name="grns")
    op.drop_index("ix_inventory_ledger_reason", table_name="inventory_ledger")
