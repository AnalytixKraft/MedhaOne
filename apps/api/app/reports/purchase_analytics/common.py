from __future__ import annotations

from calendar import month_abbr
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from app.models.enums import GrnStatus, PurchaseBillStatus, PurchaseOrderStatus
from app.models.party import Party
from app.models.product import Product
from app.models.purchase import GRN, GRNLine, PurchaseOrder, PurchaseOrderLine
from app.models.purchase_bill import PurchaseBill, PurchaseBillLine
from app.models.warehouse import Warehouse


@dataclass(slots=True)
class PurchaseAnalyticsFilters:
    product_ids: tuple[int, ...] = ()
    brand_values: tuple[str, ...] = ()
    category_values: tuple[str, ...] = ()
    supplier_ids: tuple[int, ...] = ()
    warehouse_ids: tuple[int, ...] = ()
    date_from: date | None = None
    date_to: date | None = None
    year: int | None = None
    month: int | None = None
    page: int = 1
    page_size: int = 50


@dataclass(slots=True)
class PurchaseAnalyticsEvent:
    source_type: str
    source_id: int
    source_line_id: int
    source_date: date
    purchase_order_id: int | None
    supplier_id: int | None
    supplier_name: str
    warehouse_id: int | None
    warehouse_name: str
    product_id: int
    product_name: str
    brand: str | None
    category: str | None
    qty: Decimal
    unit_rate: Decimal
    value: Decimal

    @property
    def month_key(self) -> str:
        return self.source_date.strftime("%Y-%m")

    @property
    def month_label(self) -> str:
        return format_month_label(self.source_date.year, self.source_date.month)


@dataclass(slots=True)
class PurchaseOrderReceiptRecord:
    po_id: int
    po_number: str
    supplier_id: int
    supplier_name: str
    warehouse_id: int
    warehouse_name: str
    order_date: date
    expected_date: date | None
    status: PurchaseOrderStatus
    ordered_qty: Decimal
    received_qty: Decimal
    first_grn_date: date | None
    full_receipt_date: date | None
    grn_count: int
    partial_receipt_count: int
    closed: bool
    on_time: bool | None
    delayed: bool | None


def format_month_label(year: int, month: int) -> str:
    return f"{month_abbr[month]} {year}"


def to_decimal(value: Decimal | None, default: str = "0") -> Decimal:
    if value is None:
        return Decimal(default)
    return value


def safe_percent(numerator: Decimal, denominator: Decimal) -> Decimal:
    if denominator == 0:
        return Decimal("0")
    return (numerator / denominator) * Decimal("100")


def paginate_rows(
    rows: list[dict[str, object]],
    *,
    page: int,
    page_size: int,
) -> tuple[int, list[dict[str, object]]]:
    total = len(rows)
    offset = max(page - 1, 0) * page_size
    return total, rows[offset : offset + page_size]


def _apply_event_filters(stmt, filters: PurchaseAnalyticsFilters, *, date_column, supplier_column, warehouse_column):
    if filters.date_from is not None:
        stmt = stmt.where(date_column >= filters.date_from)
    if filters.date_to is not None:
        stmt = stmt.where(date_column <= filters.date_to)
    if filters.year is not None:
        stmt = stmt.where(func.extract("year", date_column) == filters.year)
    if filters.month is not None:
        stmt = stmt.where(func.extract("month", date_column) == filters.month)
    if filters.supplier_ids:
        stmt = stmt.where(supplier_column.in_(filters.supplier_ids))
    if filters.warehouse_ids:
        stmt = stmt.where(warehouse_column.in_(filters.warehouse_ids))
    if filters.product_ids:
        stmt = stmt.where(Product.id.in_(filters.product_ids))
    if filters.brand_values:
        stmt = stmt.where(Product.brand.in_(filters.brand_values))
    if filters.category_values:
        stmt = stmt.where(
            or_(
                Product.category.in_(filters.category_values),
                Product.hsn.in_(filters.category_values),
            )
        )
    return stmt


def _apply_po_filters(stmt, filters: PurchaseAnalyticsFilters):
    if filters.date_from is not None:
        stmt = stmt.where(PurchaseOrder.order_date >= filters.date_from)
    if filters.date_to is not None:
        stmt = stmt.where(PurchaseOrder.order_date <= filters.date_to)
    if filters.year is not None:
        stmt = stmt.where(func.extract("year", PurchaseOrder.order_date) == filters.year)
    if filters.month is not None:
        stmt = stmt.where(func.extract("month", PurchaseOrder.order_date) == filters.month)
    if filters.supplier_ids:
        stmt = stmt.where(PurchaseOrder.supplier_id.in_(filters.supplier_ids))
    if filters.warehouse_ids:
        stmt = stmt.where(PurchaseOrder.warehouse_id.in_(filters.warehouse_ids))
    if filters.product_ids:
        stmt = stmt.where(Product.id.in_(filters.product_ids))
    if filters.brand_values:
        stmt = stmt.where(Product.brand.in_(filters.brand_values))
    if filters.category_values:
        stmt = stmt.where(
            or_(
                Product.category.in_(filters.category_values),
                Product.hsn.in_(filters.category_values),
            )
        )
    return stmt


def load_purchase_events(db: Session, filters: PurchaseAnalyticsFilters) -> list[PurchaseAnalyticsEvent]:
    bill_supplier = aliased(Party)
    po_supplier = aliased(Party)
    grn_supplier = aliased(Party)
    bill_warehouse = aliased(Warehouse)
    po_warehouse = aliased(Warehouse)
    grn_warehouse = aliased(Warehouse)

    bill_stmt = (
        select(
            PurchaseBill.id.label("source_id"),
            PurchaseBillLine.id.label("source_line_id"),
            PurchaseBill.bill_date.label("source_date"),
            PurchaseBill.purchase_order_id.label("purchase_order_id"),
            func.coalesce(PurchaseBill.supplier_id, PurchaseOrder.supplier_id, GRN.supplier_id).label("supplier_id"),
            func.coalesce(
                bill_supplier.name,
                po_supplier.name,
                grn_supplier.name,
                PurchaseBill.supplier_name_raw,
                "Unknown Supplier",
            ).label("supplier_name"),
            func.coalesce(PurchaseBill.warehouse_id, PurchaseOrder.warehouse_id, GRN.warehouse_id).label("warehouse_id"),
            func.coalesce(
                bill_warehouse.name,
                po_warehouse.name,
                grn_warehouse.name,
                "Unknown Warehouse",
            ).label("warehouse_name"),
            Product.id.label("product_id"),
            Product.name.label("product_name"),
            Product.brand.label("brand"),
            func.coalesce(Product.category, Product.hsn).label("category"),
            PurchaseBillLine.qty.label("qty"),
            PurchaseBillLine.unit_price.label("unit_rate"),
            PurchaseBillLine.line_total.label("value"),
        )
        .select_from(PurchaseBillLine)
        .join(PurchaseBill, PurchaseBill.id == PurchaseBillLine.purchase_bill_id)
        .join(Product, Product.id == PurchaseBillLine.product_id)
        .outerjoin(PurchaseOrder, PurchaseOrder.id == PurchaseBill.purchase_order_id)
        .outerjoin(GRN, GRN.id == PurchaseBill.grn_id)
        .outerjoin(bill_supplier, bill_supplier.id == PurchaseBill.supplier_id)
        .outerjoin(po_supplier, po_supplier.id == PurchaseOrder.supplier_id)
        .outerjoin(grn_supplier, grn_supplier.id == GRN.supplier_id)
        .outerjoin(bill_warehouse, bill_warehouse.id == PurchaseBill.warehouse_id)
        .outerjoin(po_warehouse, po_warehouse.id == PurchaseOrder.warehouse_id)
        .outerjoin(grn_warehouse, grn_warehouse.id == GRN.warehouse_id)
        .where(PurchaseBill.status == PurchaseBillStatus.POSTED)
        .where(PurchaseBill.bill_date.isnot(None))
    )
    bill_stmt = _apply_event_filters(
        bill_stmt,
        filters,
        date_column=PurchaseBill.bill_date,
        supplier_column=func.coalesce(PurchaseBill.supplier_id, PurchaseOrder.supplier_id, GRN.supplier_id),
        warehouse_column=func.coalesce(PurchaseBill.warehouse_id, PurchaseOrder.warehouse_id, GRN.warehouse_id),
    )

    posted_bill_exists = (
        select(PurchaseBillLine.id)
        .join(PurchaseBill, PurchaseBill.id == PurchaseBillLine.purchase_bill_id)
        .where(PurchaseBill.status == PurchaseBillStatus.POSTED)
        .where(PurchaseBill.purchase_order_id == GRN.purchase_order_id)
        .where(PurchaseBillLine.product_id == GRNLine.product_id)
        .limit(1)
        .exists()
    )

    grn_stmt = (
        select(
            GRN.id.label("source_id"),
            GRNLine.id.label("source_line_id"),
            GRN.received_date.label("source_date"),
            GRN.purchase_order_id.label("purchase_order_id"),
            GRN.supplier_id.label("supplier_id"),
            Party.name.label("supplier_name"),
            GRN.warehouse_id.label("warehouse_id"),
            Warehouse.name.label("warehouse_name"),
            Product.id.label("product_id"),
            Product.name.label("product_name"),
            Product.brand.label("brand"),
            func.coalesce(Product.category, Product.hsn).label("category"),
            func.coalesce(GRNLine.received_qty_total, GRNLine.received_qty).label("qty"),
            func.coalesce(GRNLine.unit_cost, PurchaseOrderLine.unit_cost, Decimal("0")).label("unit_rate"),
            (
                func.coalesce(GRNLine.received_qty_total, GRNLine.received_qty)
                * func.coalesce(GRNLine.unit_cost, PurchaseOrderLine.unit_cost, Decimal("0"))
            ).label("value"),
        )
        .select_from(GRNLine)
        .join(GRN, GRN.id == GRNLine.grn_id)
        .join(Product, Product.id == GRNLine.product_id)
        .join(Party, Party.id == GRN.supplier_id)
        .join(Warehouse, Warehouse.id == GRN.warehouse_id)
        .outerjoin(PurchaseOrderLine, PurchaseOrderLine.id == GRNLine.po_line_id)
        .where(GRN.status == GrnStatus.POSTED)
        .where(GRN.received_date.isnot(None))
        .where(~posted_bill_exists)
    )
    grn_stmt = _apply_event_filters(
        grn_stmt,
        filters,
        date_column=GRN.received_date,
        supplier_column=GRN.supplier_id,
        warehouse_column=GRN.warehouse_id,
    )

    bill_rows = list(db.execute(bill_stmt).mappings())
    grn_rows = list(db.execute(grn_stmt).mappings())
    rows = [("BILL", row) for row in bill_rows] + [("GRN", row) for row in grn_rows]
    events: list[PurchaseAnalyticsEvent] = []
    for source_type, row in rows:
        events.append(
            PurchaseAnalyticsEvent(
                source_type=source_type,
                source_id=row["source_id"],
                source_line_id=row["source_line_id"],
                source_date=row["source_date"],
                purchase_order_id=row["purchase_order_id"],
                supplier_id=row["supplier_id"],
                supplier_name=row["supplier_name"],
                warehouse_id=row["warehouse_id"],
                warehouse_name=row["warehouse_name"],
                product_id=row["product_id"],
                product_name=row["product_name"],
                brand=row["brand"],
                category=row["category"],
                qty=to_decimal(row["qty"]),
                unit_rate=to_decimal(row["unit_rate"]),
                value=to_decimal(row["value"]),
            )
        )

    events.sort(
        key=lambda item: (
            item.source_date,
            item.product_name,
            item.supplier_name,
            item.source_id,
            item.source_line_id,
        )
    )
    return events


def load_purchase_order_receipt_records(
    db: Session,
    filters: PurchaseAnalyticsFilters,
) -> list[PurchaseOrderReceiptRecord]:
    po_lines_stmt = (
        select(
            PurchaseOrder.id.label("po_id"),
            PurchaseOrder.po_number.label("po_number"),
            PurchaseOrder.supplier_id.label("supplier_id"),
            Party.name.label("supplier_name"),
            PurchaseOrder.warehouse_id.label("warehouse_id"),
            Warehouse.name.label("warehouse_name"),
            PurchaseOrder.order_date.label("order_date"),
            PurchaseOrder.expected_date.label("expected_date"),
            PurchaseOrder.status.label("status"),
            PurchaseOrderLine.id.label("po_line_id"),
            PurchaseOrderLine.ordered_qty.label("ordered_qty"),
            Product.id.label("product_id"),
        )
        .select_from(PurchaseOrderLine)
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderLine.purchase_order_id)
        .join(Product, Product.id == PurchaseOrderLine.product_id)
        .join(Party, Party.id == PurchaseOrder.supplier_id)
        .join(Warehouse, Warehouse.id == PurchaseOrder.warehouse_id)
    )
    po_lines_stmt = _apply_po_filters(po_lines_stmt, filters)
    po_lines = list(db.execute(po_lines_stmt).mappings())
    if not po_lines:
        return []

    po_line_ids = [row["po_line_id"] for row in po_lines]
    receipt_stmt = (
        select(
            GRN.purchase_order_id.label("po_id"),
            GRNLine.po_line_id.label("po_line_id"),
            GRN.id.label("grn_id"),
            GRN.received_date.label("received_date"),
            func.coalesce(GRNLine.received_qty_total, GRNLine.received_qty).label("received_qty"),
        )
        .select_from(GRNLine)
        .join(GRN, GRN.id == GRNLine.grn_id)
        .where(GRN.status == GrnStatus.POSTED)
        .where(GRNLine.po_line_id.in_(po_line_ids))
    )
    receipts = list(db.execute(receipt_stmt).mappings())

    receipts_by_line: dict[int, list[dict[str, object]]] = {}
    for receipt in receipts:
        receipts_by_line.setdefault(receipt["po_line_id"], []).append(dict(receipt))

    po_state: dict[int, dict[str, object]] = {}
    for row in po_lines:
        po = po_state.setdefault(
            row["po_id"],
            {
                "po_id": row["po_id"],
                "po_number": row["po_number"],
                "supplier_id": row["supplier_id"],
                "supplier_name": row["supplier_name"],
                "warehouse_id": row["warehouse_id"],
                "warehouse_name": row["warehouse_name"],
                "order_date": row["order_date"],
                "expected_date": row["expected_date"],
                "status": row["status"],
                "ordered_qty": Decimal("0"),
                "received_qty": Decimal("0"),
                "ordered_by_line": {},
                "received_by_line": {},
                "events": [],
                "grn_ids": set(),
            },
        )
        ordered_qty = to_decimal(row["ordered_qty"])
        po["ordered_qty"] += ordered_qty
        po["ordered_by_line"][row["po_line_id"]] = ordered_qty
        po["received_by_line"].setdefault(row["po_line_id"], Decimal("0"))

        for receipt in receipts_by_line.get(row["po_line_id"], []):
            received_qty = to_decimal(receipt["received_qty"])
            po["received_qty"] += received_qty
            po["events"].append(
                (
                    receipt["received_date"],
                    receipt["grn_id"],
                    row["po_line_id"],
                    received_qty,
                )
            )
            po["grn_ids"].add(receipt["grn_id"])

    records: list[PurchaseOrderReceiptRecord] = []
    for payload in po_state.values():
        events = sorted(payload["events"], key=lambda item: (item[0], item[1], item[2]))
        first_grn_date = events[0][0] if events else None
        full_receipt_date = None
        for received_date, _grn_id, po_line_id, received_qty in events:
            payload["received_by_line"][po_line_id] += received_qty
            if full_receipt_date is None and all(
                payload["received_by_line"][line_id] >= ordered_qty
                for line_id, ordered_qty in payload["ordered_by_line"].items()
            ):
                full_receipt_date = received_date

        grn_count = len(payload["grn_ids"])
        partial_receipt_count = max(grn_count - 1, 0)
        closed = payload["status"] == PurchaseOrderStatus.CLOSED or payload["received_qty"] >= payload["ordered_qty"]
        on_time = None
        delayed = None
        if payload["expected_date"] is not None and first_grn_date is not None:
            on_time = first_grn_date <= payload["expected_date"]
            delayed = not on_time

        records.append(
            PurchaseOrderReceiptRecord(
                po_id=payload["po_id"],
                po_number=payload["po_number"],
                supplier_id=payload["supplier_id"],
                supplier_name=payload["supplier_name"],
                warehouse_id=payload["warehouse_id"],
                warehouse_name=payload["warehouse_name"],
                order_date=payload["order_date"],
                expected_date=payload["expected_date"],
                status=payload["status"],
                ordered_qty=payload["ordered_qty"],
                received_qty=payload["received_qty"],
                first_grn_date=first_grn_date,
                full_receipt_date=full_receipt_date,
                grn_count=grn_count,
                partial_receipt_count=partial_receipt_count,
                closed=closed,
                on_time=on_time,
                delayed=delayed,
            )
        )

    records.sort(key=lambda item: (item.order_date, item.po_id))
    return records


def build_summary_metric(key: str, label: str, value: object) -> dict[str, object]:
    return {"key": key, "label": label, "value": value}


def sort_month_rows(rows: list[dict[str, object]], month_key: str = "month_sort") -> list[dict[str, object]]:
    return sorted(rows, key=lambda row: (row.get(month_key), row.get("product", ""), row.get("supplier", "")))
