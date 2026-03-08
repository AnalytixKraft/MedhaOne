from datetime import date
from decimal import Decimal
from typing import Callable, TypeVar

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal, reset_search_path, set_tenant_search_path
from app.core.security import get_password_hash
from app.core.tenancy import build_tenant_schema_name, quote_schema_name, validate_org_slug
from app.models.batch import Batch
from app.models.enums import PartyType
from app.models.inventory import InventoryLedger, StockSummary
from app.models.party import Party
from app.models.product import Product
from app.models.user import User
from app.models.warehouse import Warehouse
from app.services.rbac import assign_roles_to_user, ensure_rbac_seeded
from app.services.tax_rates import seed_tenant_tax_rates_for_schema
from app.services.tenancy import run_tenant_schema_migrations

router = APIRouter(prefix="/test", tags=["Test"])
TEST_ORG_SLUG_DEFAULT = "e2e_local"
TEST_USER_EMAIL = "e2e.admin@medhaone.app"
TEST_USER_PASSWORD = "ChangeMe123!"
T = TypeVar("T")


class ResetAndSeedRequest(BaseModel):
    seed_minimal: bool = True
    org_slug: str = TEST_ORG_SLUG_DEFAULT
    org_name: str | None = None


class ResetAndSeedResponse(BaseModel):
    ok: bool
    admin_email: str
    admin_password: str
    org_slug: str
    seed_minimal: bool


class StockSummaryLookupResponse(BaseModel):
    warehouse_id: int
    product_id: int
    batch_id: int
    qty_on_hand: Decimal


class LedgerDuplicateRow(BaseModel):
    ref_id: str
    count: int


class LedgerDuplicateCheckResponse(BaseModel):
    has_duplicates: bool
    duplicate_refs: list[LedgerDuplicateRow]


def _ensure_enabled() -> None:
    if not get_settings().enable_test_endpoints:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def _validate_test_org_slug(raw_slug: str) -> str:
    org_slug = validate_org_slug(raw_slug)
    if not org_slug.startswith("e2e_"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Test reset endpoints can only target org slugs prefixed with 'e2e_'",
        )
    return org_slug


def _reset_test_tenant_schema(org_slug: str, org_name: str) -> None:
    schema_name = build_tenant_schema_name(org_slug)

    with SessionLocal() as db:
        db.execute(
            text(
                """
                INSERT INTO public.organizations (
                    id,
                    name,
                    schema_name,
                    max_users,
                    is_active,
                    created_by_id
                )
                VALUES (
                    :org_slug,
                    :org_name,
                    :schema_name,
                    100,
                    TRUE,
                    NULL
                )
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    schema_name = EXCLUDED.schema_name,
                    is_active = TRUE,
                    updated_at = NOW()
                """
            ),
            {
                "org_slug": org_slug,
                "org_name": org_name,
                "schema_name": schema_name,
            },
        )
        db.commit()
        db.execute(text(f"DROP SCHEMA IF EXISTS {quote_schema_name(schema_name)} CASCADE"))
        db.execute(text(f"CREATE SCHEMA {quote_schema_name(schema_name)}"))
        db.commit()

    run_tenant_schema_migrations(schema_name)
    seed_tenant_tax_rates_for_schema(schema_name)


def _run_in_test_schema(org_slug: str, func: Callable[[Session], T]) -> T:
    schema_name = build_tenant_schema_name(org_slug)

    with SessionLocal() as db:
        set_tenant_search_path(db, schema_name)
        try:
            result = func(db)
            db.commit()
            return result
        except Exception:
            db.rollback()
            raise
        finally:
            reset_search_path(db)


def _ensure_test_user(org_slug: str) -> str:
    with SessionLocal() as db:
        roles_by_name = ensure_rbac_seeded(db)
        org_admin_role = roles_by_name["ORG_ADMIN"]

        user = db.query(User).filter(User.email == TEST_USER_EMAIL).first()
        if user is None:
            user = User(
                email=TEST_USER_EMAIL,
                full_name="E2E Tenant Test User",
                hashed_password=get_password_hash(TEST_USER_PASSWORD),
                auth_provider="LOCAL",
                organization_slug=org_slug,
                is_active=True,
                is_superuser=False,
                role_id=org_admin_role.id,
            )
            db.add(user)
            db.flush()
        else:
            user.full_name = "E2E Tenant Test User"
            user.hashed_password = get_password_hash(TEST_USER_PASSWORD)
            user.auth_provider = "LOCAL"
            user.external_subject = None
            user.organization_slug = org_slug
            user.is_active = True
            user.is_superuser = False
            user.role_id = org_admin_role.id

        assign_roles_to_user(db, user, [org_admin_role.id])
        db.commit()
        db.refresh(user)
        return user.email


def _seed_minimal(org_slug: str) -> None:
    def seed(db: Session) -> None:
        supplier = Party(
            name="Seed Supplier",
            party_type=PartyType.SUPER_STOCKIST,
            phone="9999999999",
            is_active=True,
        )
        db.add(supplier)

        warehouse = Warehouse(name="Seed Warehouse", code="SEEDWH", is_active=True)
        db.add(warehouse)

        product = Product(
            sku="SEEDSKU001",
            name="Seed Product",
            brand="AnalytixKraft",
            uom="BOX",
            is_active=True,
        )
        db.add(product)
        db.flush()

        batch = Batch(
            product_id=product.id,
            batch_no="SEED-B1",
            expiry_date=date(2030, 12, 31),
        )
        db.add(batch)

    _run_in_test_schema(org_slug, seed)


@router.post("/reset-and-seed", response_model=ResetAndSeedResponse)
def reset_and_seed(payload: ResetAndSeedRequest) -> ResetAndSeedResponse:
    _ensure_enabled()
    org_slug = _validate_test_org_slug(payload.org_slug)
    org_name = payload.org_name or f"E2E {org_slug.replace('_', ' ').title()}"

    _reset_test_tenant_schema(org_slug, org_name)
    admin_email = _ensure_test_user(org_slug)

    if payload.seed_minimal:
        _seed_minimal(org_slug)

    return ResetAndSeedResponse(
        ok=True,
        admin_email=admin_email,
        admin_password=TEST_USER_PASSWORD,
        org_slug=org_slug,
        seed_minimal=payload.seed_minimal,
    )


@router.get("/stock-summary", response_model=StockSummaryLookupResponse)
def get_stock_summary(
    org_slug: str = Query(default=TEST_ORG_SLUG_DEFAULT),
    warehouse_id: int | None = Query(default=None),
    product_id: int | None = Query(default=None),
    batch_id: int | None = Query(default=None),
    warehouse_code: str | None = Query(default=None),
    product_sku: str | None = Query(default=None),
    batch_no: str | None = Query(default=None),
    expiry_date: date | None = Query(default=None),
) -> StockSummaryLookupResponse:
    _ensure_enabled()
    safe_org_slug = _validate_test_org_slug(org_slug)

    def load(db: Session) -> StockSummaryLookupResponse:
        stmt = (
            select(StockSummary)
            .join(Warehouse, StockSummary.warehouse_id == Warehouse.id)
            .join(Product, StockSummary.product_id == Product.id)
            .join(Batch, StockSummary.batch_id == Batch.id)
        )

        if warehouse_id is not None:
            stmt = stmt.where(StockSummary.warehouse_id == warehouse_id)
        if product_id is not None:
            stmt = stmt.where(StockSummary.product_id == product_id)
        if batch_id is not None:
            stmt = stmt.where(StockSummary.batch_id == batch_id)

        if warehouse_code:
            stmt = stmt.where(Warehouse.code == warehouse_code)
        if product_sku:
            stmt = stmt.where(Product.sku == product_sku)
        if batch_no:
            stmt = stmt.where(Batch.batch_no == batch_no)
        if expiry_date:
            stmt = stmt.where(Batch.expiry_date == expiry_date)

        record = db.execute(stmt).scalar_one_or_none()
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stock summary not found for provided lookup",
            )

        return StockSummaryLookupResponse(
            warehouse_id=record.warehouse_id,
            product_id=record.product_id,
            batch_id=record.batch_id,
            qty_on_hand=record.qty_on_hand,
        )

    return _run_in_test_schema(safe_org_slug, load)


@router.get("/ledger-grn-duplicates", response_model=LedgerDuplicateCheckResponse)
def get_ledger_grn_duplicates(
    org_slug: str = Query(default=TEST_ORG_SLUG_DEFAULT),
) -> LedgerDuplicateCheckResponse:
    _ensure_enabled()
    safe_org_slug = _validate_test_org_slug(org_slug)

    def load(db: Session) -> LedgerDuplicateCheckResponse:
        rows = (
            db.query(
                InventoryLedger.ref_id,
                func.count(InventoryLedger.id).label("count"),
            )
            .filter(InventoryLedger.ref_type == "GRN")
            .filter(InventoryLedger.ref_id.isnot(None))
            .group_by(InventoryLedger.ref_id)
            .having(func.count(InventoryLedger.id) > 1)
            .all()
        )
        duplicates = [
            LedgerDuplicateRow(ref_id=str(row.ref_id), count=int(row.count))
            for row in rows
            if row.ref_id
        ]
        return LedgerDuplicateCheckResponse(
            has_duplicates=len(duplicates) > 0,
            duplicate_refs=duplicates,
        )

    return _run_in_test_schema(safe_org_slug, load)
