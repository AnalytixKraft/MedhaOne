from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import String, and_, cast, func, select
from sqlalchemy.orm import Session

from app.models.enums import InventoryReason
from app.models.inventory import InventoryLedger
from app.models.party import Party
from app.models.product import Product
from app.models.purchase import GRN, GRNBatchLine, GRNLine, PurchaseOrder
from app.models.user import User
from app.models.warehouse import Warehouse
from app.models.batch import Batch


@dataclass(slots=True)
class StockInwardFilters:
    date_from: date | None = None
    date_to: date | None = None
    supplier_id: int | None = None
    supplier_ids: tuple[int, ...] = ()
    warehouse_id: int | None = None
    warehouse_ids: tuple[int, ...] = ()
    product_id: int | None = None
    product_ids: tuple[int, ...] = ()
    brand_values: tuple[str, ...] = ()
    category_values: tuple[str, ...] = ()
    batch_nos: tuple[str, ...] = ()
    expiry_status: str | None = None
    page: int = 1
    page_size: int = 50


def get_stock_inward_report(
    db: Session,
    filters: StockInwardFilters,
) -> tuple[int, list[dict[str, object]]]:
    line_totals = (
        select(
            GRNLine.grn_id.label("grn_id"),
            GRNLine.product_id.label("product_id"),
            GRNBatchLine.batch_id.label("batch_id"),
            func.sum(GRNBatchLine.received_qty).label("qty_received"),
            func.sum(GRNBatchLine.free_qty).label("free_qty"),
        )
        .select_from(GRNBatchLine)
        .join(GRNLine, GRNLine.id == GRNBatchLine.grn_line_id)
        .group_by(GRNLine.grn_id, GRNLine.product_id, GRNBatchLine.batch_id)
        .subquery()
    )

    stmt = (
        select(
            InventoryLedger.id.label("ledger_id"),
            GRN.grn_number.label("grn_number"),
            PurchaseOrder.po_number.label("po_number"),
            Party.name.label("supplier_name"),
            Warehouse.name.label("warehouse_name"),
            Product.name.label("product_name"),
            Product.quantity_precision.label("quantity_precision"),
            Batch.batch_no.label("batch_no"),
            Batch.expiry_date.label("expiry_date"),
            func.coalesce(line_totals.c.qty_received, InventoryLedger.qty).label("qty_received"),
            func.coalesce(line_totals.c.free_qty, Decimal("0")).label("free_qty"),
            GRN.received_date.label("received_date"),
            User.full_name.label("posted_by"),
        )
        .select_from(InventoryLedger)
        .join(
            GRN,
            and_(
                InventoryLedger.ref_type == "GRN",
                GRN.grn_number == InventoryLedger.ref_id,
            ),
        )
        .join(PurchaseOrder, PurchaseOrder.id == GRN.purchase_order_id)
        .join(Party, Party.id == GRN.supplier_id)
        .join(Warehouse, Warehouse.id == InventoryLedger.warehouse_id)
        .join(Product, Product.id == InventoryLedger.product_id)
        .join(Batch, Batch.id == InventoryLedger.batch_id)
        .outerjoin(
            line_totals,
            and_(
                line_totals.c.grn_id == GRN.id,
                line_totals.c.product_id == InventoryLedger.product_id,
                line_totals.c.batch_id == InventoryLedger.batch_id,
            ),
        )
        # Some tenant schemas include an RBAC users table with text IDs; compare as text
        # so report queries remain stable regardless of users.id physical type.
        .outerjoin(User, cast(User.id, String) == cast(GRN.posted_by, String))
        .where(InventoryLedger.reason == InventoryReason.PURCHASE_GRN)
    )

    if filters.date_from is not None:
        stmt = stmt.where(GRN.received_date >= filters.date_from)
    if filters.date_to is not None:
        stmt = stmt.where(GRN.received_date <= filters.date_to)
    if filters.supplier_id is not None:
        stmt = stmt.where(GRN.supplier_id == filters.supplier_id)
    if filters.supplier_ids:
        stmt = stmt.where(GRN.supplier_id.in_(filters.supplier_ids))
    if filters.warehouse_id is not None:
        stmt = stmt.where(InventoryLedger.warehouse_id == filters.warehouse_id)
    if filters.warehouse_ids:
        stmt = stmt.where(InventoryLedger.warehouse_id.in_(filters.warehouse_ids))
    if filters.product_id is not None:
        stmt = stmt.where(InventoryLedger.product_id == filters.product_id)
    if filters.product_ids:
        stmt = stmt.where(InventoryLedger.product_id.in_(filters.product_ids))
    if filters.brand_values:
        stmt = stmt.where(Product.brand.in_(filters.brand_values))
    if filters.category_values:
        stmt = stmt.where(Product.hsn.in_(filters.category_values))
    if filters.batch_nos:
        stmt = stmt.where(Batch.batch_no.in_(filters.batch_nos))
    if filters.expiry_status:
        today = date.today()
        threshold = today + timedelta(days=30)
        if filters.expiry_status == "expired":
            stmt = stmt.where(Batch.expiry_date < today)
        elif filters.expiry_status == "expiring_30":
            stmt = stmt.where(Batch.expiry_date >= today).where(Batch.expiry_date <= threshold)
        elif filters.expiry_status == "safe":
            stmt = stmt.where(Batch.expiry_date > threshold)

    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = int(db.execute(count_stmt).scalar_one())

    offset = (filters.page - 1) * filters.page_size
    rows = db.execute(
        stmt.order_by(GRN.received_date.desc(), InventoryLedger.id.desc())
        .offset(offset)
        .limit(filters.page_size)
    ).mappings()

    data: list[dict[str, object]] = []
    for row in rows:
        data.append(
            {
                "grn_number": row["grn_number"],
                "po_number": row["po_number"],
                "supplier_name": row["supplier_name"],
                "warehouse_name": row["warehouse_name"],
                "product_name": row["product_name"],
                "quantity_precision": row["quantity_precision"],
                "batch_no": row["batch_no"],
                "expiry_date": row["expiry_date"],
                "qty_received": row["qty_received"] or Decimal("0"),
                "free_qty": row["free_qty"] or Decimal("0"),
                "received_date": row["received_date"],
                "posted_by": row["posted_by"],
            }
        )

    return total, data
