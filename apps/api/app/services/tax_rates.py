from __future__ import annotations

from decimal import Decimal
from typing import Final

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, reset_search_path, set_tenant_search_path

DEFAULT_GLOBAL_TAX_RATES: Final[tuple[dict[str, Decimal | str], ...]] = (
    {"code": "GST_0", "label": "GST 0%", "rate_percent": Decimal("0.00")},
    {"code": "GST_5", "label": "GST 5%", "rate_percent": Decimal("5.00")},
    {"code": "GST_12", "label": "GST 12%", "rate_percent": Decimal("12.00")},
    {"code": "GST_28", "label": "GST 28%", "rate_percent": Decimal("28.00")},
)


def ensure_tenant_tax_rate_table(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS tax_rates (
              id SERIAL PRIMARY KEY,
              code VARCHAR(40) NOT NULL UNIQUE,
              label VARCHAR(120) NOT NULL,
              rate_percent NUMERIC(5, 2) NOT NULL,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              CONSTRAINT ck_tax_rates_rate_percent_range CHECK (rate_percent >= 0 AND rate_percent <= 100)
            )
            """
        )
    )
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_tax_rates_rate_percent ON tax_rates (rate_percent)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_tax_rates_is_active ON tax_rates (is_active)"))
    db.flush()


def initialize_tenant_tax_rates(db: Session) -> None:
    ensure_tenant_tax_rate_table(db)
    seed_tenant_tax_rates(db, only_if_empty=True)


def seed_tenant_tax_rates(db: Session, *, only_if_empty: bool) -> int:
    ensure_tenant_tax_rate_table(db)

    existing_count = db.execute(text("SELECT COUNT(*) FROM tax_rates")).scalar_one()
    if only_if_empty and int(existing_count or 0) > 0:
        return 0

    templates = _active_global_templates_or_defaults(db)
    inserted = 0
    for template in templates:
        result = db.execute(
            text(
                """
                INSERT INTO tax_rates (code, label, rate_percent, is_active)
                VALUES (:code, :label, :rate_percent, TRUE)
                ON CONFLICT (code) DO NOTHING
                """
            ),
            {
                "code": str(template["code"]),
                "label": str(template["label"]),
                "rate_percent": template["rate_percent"],
            },
        )
        inserted += int(result.rowcount or 0)

    return inserted


def seed_tenant_tax_rates_for_schema(schema_name: str) -> None:
    with SessionLocal() as db:
        set_tenant_search_path(db, schema_name)
        try:
            seed_tenant_tax_rates(db, only_if_empty=False)
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            reset_search_path(db)


def _active_global_templates_or_defaults(db: Session) -> list[dict[str, Decimal | str]]:
    global_table_exists = db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'global_tax_rates'
            """
        )
    ).scalar_one_or_none()

    if global_table_exists is None:
        return [dict(rate) for rate in DEFAULT_GLOBAL_TAX_RATES]

    rows = db.execute(
        text(
            """
            SELECT code, label, rate_percent
            FROM public.global_tax_rates
            WHERE is_active IS TRUE
            ORDER BY rate_percent ASC, id ASC
            """
        )
    ).mappings().all()

    if not rows:
        return [dict(rate) for rate in DEFAULT_GLOBAL_TAX_RATES]

    return [
        {
            "code": str(row["code"]),
            "label": str(row["label"]),
            "rate_percent": Decimal(str(row["rate_percent"])),
        }
        for row in rows
    ]
