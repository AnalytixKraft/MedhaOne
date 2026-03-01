"""add external auth bridge fields to users

Revision ID: 20260301_0008
Revises: 20260228_0007
Create Date: 2026-03-01 13:30:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260301_0008"
down_revision: str | None = "20260228_0007"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("auth_provider", sa.String(length=32), nullable=False, server_default="LOCAL"),
    )
    op.add_column("users", sa.Column("external_subject", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("organization_slug", sa.String(length=255), nullable=True))

    op.create_index("ix_users_auth_provider", "users", ["auth_provider"], unique=False)
    op.create_index("ix_users_external_subject", "users", ["external_subject"], unique=True)
    op.create_index("ix_users_organization_slug", "users", ["organization_slug"], unique=False)

    op.execute("UPDATE users SET auth_provider = 'LOCAL' WHERE auth_provider IS NULL")

    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("auth_provider", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_users_organization_slug", table_name="users")
    op.drop_index("ix_users_external_subject", table_name="users")
    op.drop_index("ix_users_auth_provider", table_name="users")

    op.drop_column("users", "organization_slug")
    op.drop_column("users", "external_subject")
    op.drop_column("users", "auth_provider")
