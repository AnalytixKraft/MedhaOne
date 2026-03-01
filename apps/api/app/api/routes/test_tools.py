from datetime import date
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.database import Base, SessionLocal, engine
from app.models.batch import Batch
from app.models.enums import PartyType
from app.models.inventory import InventoryLedger, StockSummary
from app.models.party import Party
from app.models.product import Product
from app.models.warehouse import Warehouse
from app.services.rbac import ensure_admin_user

router = APIRouter(prefix="/test", tags=["Test"])


class ResetAndSeedRequest(BaseModel):
    seed_minimal: bool = True


class ResetAndSeedResponse(BaseModel):
    ok: bool
    admin_email: str
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


def _reset_schema() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def _seed_admin() -> str:
    with SessionLocal() as db:
        user = ensure_admin_user(db)
        return user.email


def _seed_minimal() -> None:
    with SessionLocal() as db:
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
        db.commit()


@router.post("/reset-and-seed", response_model=ResetAndSeedResponse)
def reset_and_seed(payload: ResetAndSeedRequest) -> ResetAndSeedResponse:
    _ensure_enabled()

    _reset_schema()
    admin_email = _seed_admin()

    if payload.seed_minimal:
        _seed_minimal()

    return ResetAndSeedResponse(ok=True, admin_email=admin_email, seed_minimal=payload.seed_minimal)


@router.get("/stock-summary", response_model=StockSummaryLookupResponse)
def get_stock_summary(
    warehouse_id: int | None = Query(default=None),
    product_id: int | None = Query(default=None),
    batch_id: int | None = Query(default=None),
    warehouse_code: str | None = Query(default=None),
    product_sku: str | None = Query(default=None),
    batch_no: str | None = Query(default=None),
    expiry_date: date | None = Query(default=None),
) -> StockSummaryLookupResponse:
    _ensure_enabled()

    with SessionLocal() as db:
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


@router.get("/ledger-grn-duplicates", response_model=LedgerDuplicateCheckResponse)
def get_ledger_grn_duplicates() -> LedgerDuplicateCheckResponse:
    _ensure_enabled()

    with SessionLocal() as db:
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
