"""add warehouse rack master

Revision ID: 20260311_0029
Revises: 20260309_0028
Create Date: 2026-03-11 21:45:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260311_0029"
down_revision = "20260309_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("racks"):
        op.create_table(
            "racks",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("warehouse_id", sa.Integer(), nullable=False),
            sa.Column("rack_number", sa.String(length=120), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column(
                "is_active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            ),
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
            sa.ForeignKeyConstraint(
                ["warehouse_id"],
                ["warehouses.id"],
                ondelete="CASCADE",
            ),
            sa.UniqueConstraint(
                "warehouse_id",
                "rack_number",
                name="uq_racks_warehouse_rack_number",
            ),
        )
        op.create_index("ix_racks_id", "racks", ["id"], unique=False)
        op.create_index("ix_racks_warehouse_id", "racks", ["warehouse_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("racks"):
        op.drop_index("ix_racks_warehouse_id", table_name="racks")
        op.drop_index("ix_racks_id", table_name="racks")
        op.drop_table("racks")
