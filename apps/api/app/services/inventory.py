from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.enums import InventoryReason, InventoryTxnType
from app.models.inventory import InventoryLedger, StockSummary
from app.models.product import Product
from app.models.warehouse import Warehouse


class InventoryError(Exception):
    pass


@dataclass
class InventoryResult:
    ledger: InventoryLedger
    summary: StockSummary


def _as_decimal(value: Decimal | float | int) -> Decimal:
    return Decimal(str(value))


def _load_summary_for_update(
    db: Session,
    *,
    warehouse_id: int,
    product_id: int,
    batch_id: int,
) -> StockSummary | None:
    stmt = (
        select(StockSummary)
        .where(StockSummary.warehouse_id == warehouse_id)
        .where(StockSummary.product_id == product_id)
        .where(StockSummary.batch_id == batch_id)
        .with_for_update()
    )
    return db.execute(stmt).scalar_one_or_none()


def _ensure_valid_refs(db: Session, *, warehouse_id: int, product_id: int, batch_id: int) -> None:
    warehouse = db.get(Warehouse, warehouse_id)
    if not warehouse:
        raise InventoryError("Warehouse not found")

    product = db.get(Product, product_id)
    if not product:
        raise InventoryError("Product not found")

    batch = db.get(Batch, batch_id)
    if not batch:
        raise InventoryError("Batch not found")

    if batch.product_id != product_id:
        raise InventoryError("Batch does not belong to the selected product")


def _create_ledger(
    db: Session,
    *,
    txn_type: InventoryTxnType,
    reason: InventoryReason,
    warehouse_id: int,
    product_id: int,
    batch_id: int,
    qty: Decimal,
    created_by: int,
    ref_type: str | None,
    ref_id: str | None,
) -> InventoryLedger:
    # InventoryLedger is immutable by design: insert-only, never updated or deleted.
    ledger = InventoryLedger(
        txn_type=txn_type,
        reason=reason,
        warehouse_id=warehouse_id,
        product_id=product_id,
        batch_id=batch_id,
        qty=qty,
        created_by=created_by,
        ref_type=ref_type,
        ref_id=ref_id,
    )
    db.add(ledger)
    db.flush()
    return ledger


def stock_in(
    db: Session,
    *,
    warehouse_id: int,
    product_id: int,
    batch_id: int,
    qty: Decimal,
    reason: InventoryReason,
    created_by: int,
    ref_type: str | None = None,
    ref_id: str | None = None,
    commit: bool = True,
) -> InventoryResult:
    qty_dec = _as_decimal(qty)
    if qty_dec <= 0:
        raise InventoryError("Quantity must be greater than zero")

    try:
        _ensure_valid_refs(db, warehouse_id=warehouse_id, product_id=product_id, batch_id=batch_id)

        summary = _load_summary_for_update(
            db,
            warehouse_id=warehouse_id,
            product_id=product_id,
            batch_id=batch_id,
        )
        if not summary:
            summary = StockSummary(
                warehouse_id=warehouse_id,
                product_id=product_id,
                batch_id=batch_id,
                qty_on_hand=Decimal("0"),
            )
            db.add(summary)
            db.flush()

        summary.qty_on_hand = _as_decimal(summary.qty_on_hand) + qty_dec

        ledger = _create_ledger(
            db,
            txn_type=InventoryTxnType.IN,
            reason=reason,
            warehouse_id=warehouse_id,
            product_id=product_id,
            batch_id=batch_id,
            qty=qty_dec,
            created_by=created_by,
            ref_type=ref_type,
            ref_id=ref_id,
        )
        if commit:
            db.commit()
        else:
            db.flush()
    except Exception:
        if commit:
            db.rollback()
        raise

    if commit:
        db.refresh(ledger)
        db.refresh(summary)
    return InventoryResult(ledger=ledger, summary=summary)


def stock_out(
    db: Session,
    *,
    warehouse_id: int,
    product_id: int,
    batch_id: int,
    qty: Decimal,
    reason: InventoryReason,
    created_by: int,
    ref_type: str | None = None,
    ref_id: str | None = None,
    commit: bool = True,
) -> InventoryResult:
    qty_dec = _as_decimal(qty)
    if qty_dec <= 0:
        raise InventoryError("Quantity must be greater than zero")

    try:
        _ensure_valid_refs(db, warehouse_id=warehouse_id, product_id=product_id, batch_id=batch_id)

        summary = _load_summary_for_update(
            db,
            warehouse_id=warehouse_id,
            product_id=product_id,
            batch_id=batch_id,
        )

        available = _as_decimal(summary.qty_on_hand) if summary else Decimal("0")
        if available < qty_dec:
            raise InventoryError("Insufficient stock for stock out")

        summary.qty_on_hand = available - qty_dec

        ledger = _create_ledger(
            db,
            txn_type=InventoryTxnType.OUT,
            reason=reason,
            warehouse_id=warehouse_id,
            product_id=product_id,
            batch_id=batch_id,
            qty=-qty_dec,
            created_by=created_by,
            ref_type=ref_type,
            ref_id=ref_id,
        )
        if commit:
            db.commit()
        else:
            db.flush()
    except Exception:
        if commit:
            db.rollback()
        raise

    if commit:
        db.refresh(ledger)
        db.refresh(summary)
    return InventoryResult(ledger=ledger, summary=summary)


def stock_adjust(
    db: Session,
    *,
    warehouse_id: int,
    product_id: int,
    batch_id: int,
    delta_qty: Decimal,
    created_by: int,
    reason: InventoryReason = InventoryReason.STOCK_ADJUSTMENT,
    commit: bool = True,
) -> InventoryResult:
    delta_dec = _as_decimal(delta_qty)
    if delta_dec == 0:
        raise InventoryError("Adjustment delta cannot be zero")

    try:
        _ensure_valid_refs(db, warehouse_id=warehouse_id, product_id=product_id, batch_id=batch_id)

        summary = _load_summary_for_update(
            db,
            warehouse_id=warehouse_id,
            product_id=product_id,
            batch_id=batch_id,
        )

        if not summary:
            if delta_dec < 0:
                raise InventoryError("Insufficient stock for negative adjustment")
            summary = StockSummary(
                warehouse_id=warehouse_id,
                product_id=product_id,
                batch_id=batch_id,
                qty_on_hand=Decimal("0"),
            )
            db.add(summary)
            db.flush()

        new_qty = _as_decimal(summary.qty_on_hand) + delta_dec
        if new_qty < 0:
            raise InventoryError("Adjustment would result in negative stock")

        summary.qty_on_hand = new_qty

        ledger = _create_ledger(
            db,
            txn_type=InventoryTxnType.ADJUST,
            reason=reason,
            warehouse_id=warehouse_id,
            product_id=product_id,
            batch_id=batch_id,
            qty=delta_dec,
            created_by=created_by,
            ref_type=None,
            ref_id=None,
        )
        if commit:
            db.commit()
        else:
            db.flush()
    except Exception:
        if commit:
            db.rollback()
        raise

    if commit:
        db.refresh(ledger)
        db.refresh(summary)
    return InventoryResult(ledger=ledger, summary=summary)
