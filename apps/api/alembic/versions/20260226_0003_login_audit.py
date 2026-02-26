"""add login audit table

Revision ID: 20260226_0003
Revises: 20260226_0002
Create Date: 2026-02-26 13:22:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260226_0003"
down_revision: str | None = "20260226_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "login_audit",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column(
            "logged_in_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_login_audit_id"), "login_audit", ["id"], unique=False)
    op.create_index(op.f("ix_login_audit_user_id"), "login_audit", ["user_id"], unique=False)
    op.create_index(op.f("ix_login_audit_ip_address"), "login_audit", ["ip_address"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_login_audit_ip_address"), table_name="login_audit")
    op.drop_index(op.f("ix_login_audit_user_id"), table_name="login_audit")
    op.drop_index(op.f("ix_login_audit_id"), table_name="login_audit")
    op.drop_table("login_audit")
