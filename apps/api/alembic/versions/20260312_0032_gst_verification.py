"""add gst_verification_logs table and gst fields on parties

Revision ID: 20260312_0032
Revises: 20260312_0031
Create Date: 2026-03-12 20:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "20260312_0032"
down_revision = "20260312_0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create gst_verification_logs table
    op.create_table(
        "gst_verification_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("party_id", sa.Integer(), nullable=True),
        sa.Column("gstin", sa.String(15), nullable=False),
        sa.Column("requested_by", sa.Integer(), nullable=False),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("source_url", sa.String(255), nullable=True),
        sa.Column("extracted_data_json", sa.JSON(), nullable=True),
        sa.Column("response_snapshot", sa.Text(), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["party_id"], ["parties.id"]),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_gst_verification_logs_id", "gst_verification_logs", ["id"])
    op.create_index("ix_gst_verification_logs_party_id", "gst_verification_logs", ["party_id"])
    op.create_index("ix_gst_verification_logs_gstin", "gst_verification_logs", ["gstin"])
    op.create_index("ix_gst_verification_logs_requested_by", "gst_verification_logs", ["requested_by"])
    op.create_index("ix_gst_verification_logs_status", "gst_verification_logs", ["status"])

    # Add GST portal verification columns to parties
    op.add_column("parties", sa.Column("gst_verified_status", sa.String(32), nullable=False, server_default="NOT_VERIFIED"))
    op.add_column("parties", sa.Column("gst_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("parties", sa.Column("gst_verified_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    op.add_column("parties", sa.Column("gst_verification_source", sa.String(255), nullable=True))
    op.add_column("parties", sa.Column("gst_legal_name", sa.String(255), nullable=True))
    op.add_column("parties", sa.Column("gst_trade_name", sa.String(255), nullable=True))
    op.add_column("parties", sa.Column("gst_registration_date", sa.Date(), nullable=True))
    op.add_column("parties", sa.Column("gst_raw_snapshot", sa.JSON(), nullable=True))


def downgrade() -> None:
    # Remove GST columns from parties
    op.drop_column("parties", "gst_raw_snapshot")
    op.drop_column("parties", "gst_registration_date")
    op.drop_column("parties", "gst_trade_name")
    op.drop_column("parties", "gst_legal_name")
    op.drop_column("parties", "gst_verification_source")
    op.drop_column("parties", "gst_verified_by")
    op.drop_column("parties", "gst_verified_at")
    op.drop_column("parties", "gst_verified_status")

    # Drop gst_verification_logs table
    op.drop_index("ix_gst_verification_logs_status", "gst_verification_logs")
    op.drop_index("ix_gst_verification_logs_requested_by", "gst_verification_logs")
    op.drop_index("ix_gst_verification_logs_gstin", "gst_verification_logs")
    op.drop_index("ix_gst_verification_logs_party_id", "gst_verification_logs")
    op.drop_index("ix_gst_verification_logs_id", "gst_verification_logs")
    op.drop_table("gst_verification_logs")
