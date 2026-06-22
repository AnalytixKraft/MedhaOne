"""add drug licence verification workflow

Revision ID: 20260312_0030
Revises: 20260311_0029
Create Date: 2026-03-12 15:00:00.000000
"""

import sqlalchemy as sa

from alembic import op

revision = "20260312_0030"
down_revision = "20260311_0029"
branch_labels = None
depends_on = None


def _current_schema(bind) -> str:
    # During tenant provisioning the search_path is the tenant schema; the inspector's
    # cached default_schema_name is "public", so existence guards must target the live
    # current_schema() or they wrongly check public and skip the tenant.
    return bind.execute(sa.text("SELECT current_schema()")).scalar() or "public"


def _existing_columns(table_name: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    existing_columns = _existing_columns("parties")

    for column in [
        sa.Column(
            "drug_license_verified_status",
            sa.String(length=32),
            nullable=False,
            server_default="NOT_VERIFIED",
        ),
        sa.Column("drug_license_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("drug_license_verified_by", sa.Integer(), nullable=True),
        sa.Column("drug_license_verification_source", sa.String(length=255), nullable=True),
        sa.Column("drug_license_holder_name", sa.String(length=255), nullable=True),
        sa.Column("drug_license_valid_upto", sa.Date(), nullable=True),
        sa.Column("drug_license_state", sa.String(length=120), nullable=True),
        sa.Column("drug_license_raw_snapshot", sa.JSON(), nullable=True),
    ]:
        if column.name not in existing_columns:
            op.add_column("parties", column)
            existing_columns.add(column.name)

    bind = op.get_bind()
    inspector = sa.inspect(bind)
    foreign_keys = {foreign_key.get("name") for foreign_key in inspector.get_foreign_keys("parties")}
    if "fk_parties_drug_license_verified_by_users" not in foreign_keys:
        op.create_foreign_key(
            "fk_parties_drug_license_verified_by_users",
            "parties",
            "users",
            ["drug_license_verified_by"],
            ["id"],
        )

    if not inspector.has_table("drug_license_verification_logs", schema=_current_schema(bind)):
        op.create_table(
            "drug_license_verification_logs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("party_id", sa.Integer(), nullable=False),
            sa.Column("drug_license_number", sa.String(length=120), nullable=False),
            sa.Column("requested_by", sa.Integer(), nullable=False),
            sa.Column(
                "requested_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("source_url", sa.String(length=255), nullable=True),
            sa.Column("extracted_data_json", sa.JSON(), nullable=True),
            sa.Column("response_snapshot", sa.Text(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(["party_id"], ["parties.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["requested_by"], ["users.id"]),
        )
        op.create_index("ix_drug_license_verification_logs_id", "drug_license_verification_logs", ["id"])
        op.create_index(
            "ix_drug_license_verification_logs_party_id",
            "drug_license_verification_logs",
            ["party_id"],
        )
        op.create_index(
            "ix_drug_license_verification_logs_requested_by",
            "drug_license_verification_logs",
            ["requested_by"],
        )
        op.create_index(
            "ix_drug_license_verification_logs_status",
            "drug_license_verification_logs",
            ["status"],
        )
        op.create_index(
            "ix_drug_license_verification_logs_license_number",
            "drug_license_verification_logs",
            ["drug_license_number"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("drug_license_verification_logs", schema=_current_schema(bind)):
        op.drop_index("ix_drug_license_verification_logs_license_number", table_name="drug_license_verification_logs")
        op.drop_index("ix_drug_license_verification_logs_status", table_name="drug_license_verification_logs")
        op.drop_index("ix_drug_license_verification_logs_requested_by", table_name="drug_license_verification_logs")
        op.drop_index("ix_drug_license_verification_logs_party_id", table_name="drug_license_verification_logs")
        op.drop_index("ix_drug_license_verification_logs_id", table_name="drug_license_verification_logs")
        op.drop_table("drug_license_verification_logs")

    foreign_keys = {foreign_key.get("name") for foreign_key in inspector.get_foreign_keys("parties")}
    if "fk_parties_drug_license_verified_by_users" in foreign_keys:
        op.drop_constraint("fk_parties_drug_license_verified_by_users", "parties", type_="foreignkey")

    existing_columns = _existing_columns("parties")
    for column_name in [
        "drug_license_raw_snapshot",
        "drug_license_state",
        "drug_license_valid_upto",
        "drug_license_holder_name",
        "drug_license_verification_source",
        "drug_license_verified_by",
        "drug_license_verified_at",
        "drug_license_verified_status",
    ]:
        if column_name in existing_columns:
            op.drop_column("parties", column_name)
