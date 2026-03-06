"""add tenant tax rates master

Revision ID: 20260305_0012
Revises: 20260304_0011
Create Date: 2026-03-05 16:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260305_0012"
down_revision: str | None = "20260304_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    schema = bind.dialect.default_schema_name
    inspector = inspect(bind)

    if not inspector.has_table("tax_rates", schema=schema):
        op.create_table(
            "tax_rates",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("code", sa.String(length=40), nullable=False),
            sa.Column("label", sa.String(length=120), nullable=False),
            sa.Column("rate_percent", sa.Numeric(precision=5, scale=2), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.CheckConstraint(
                "rate_percent >= 0 AND rate_percent <= 100",
                name="ck_tax_rates_rate_percent_range",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("code"),
        )

    op.execute('CREATE INDEX IF NOT EXISTS "ix_tax_rates_id" ON tax_rates (id)')
    op.execute('CREATE UNIQUE INDEX IF NOT EXISTS "ix_tax_rates_code" ON tax_rates (code)')
    op.execute(
        'CREATE INDEX IF NOT EXISTS "ix_tax_rates_rate_percent" ON tax_rates (rate_percent)'
    )
    op.execute('CREATE INDEX IF NOT EXISTS "ix_tax_rates_is_active" ON tax_rates (is_active)')


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS "ix_tax_rates_is_active"')
    op.execute('DROP INDEX IF EXISTS "ix_tax_rates_rate_percent"')
    op.execute('DROP INDEX IF EXISTS "ix_tax_rates_code"')
    op.execute('DROP INDEX IF EXISTS "ix_tax_rates_id"')
    op.execute("DROP TABLE IF EXISTS tax_rates")
