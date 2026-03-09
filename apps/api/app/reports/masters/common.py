from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.inventory import InventoryLedger, StockSummary
from app.models.party import Party
from app.models.product import Product
from app.models.purchase import GRN, PurchaseOrder
from app.models.sales import SalesOrder
from app.models.warehouse import Warehouse


@dataclass(slots=True)
class MasterReportFilters:
    warehouse_ids: tuple[int, ...] = ()
    brand_values: tuple[str, ...] = ()
    category_values: tuple[str, ...] = ()
    product_ids: tuple[int, ...] = ()
    party_types: tuple[str, ...] = ()
    party_categories: tuple[str, ...] = ()
    states: tuple[str, ...] = ()
    cities: tuple[str, ...] = ()
    is_active: bool | None = None
    inactivity_days: int = 30
    date_from: date | None = None
    date_to: date | None = None
    page: int = 1
    page_size: int = 50


def _paginate_rows(
    rows: list[dict[str, Any]],
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]]]:
    total = len(rows)
    start = max(filters.page - 1, 0) * filters.page_size
    return total, rows[start : start + filters.page_size]


def _decimal(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _clone_filters(filters: MasterReportFilters, **updates: Any) -> MasterReportFilters:
    payload = asdict(filters)
    payload.update(updates)
    return MasterReportFilters(**payload)


def _load_stock_positions(db: Session, filters: MasterReportFilters) -> list[dict[str, Any]]:
    stmt = (
        select(
            Product.id.label("product_id"),
            Product.sku.label("sku"),
            Product.name.label("product_name"),
            Product.brand.label("brand"),
            Product.hsn.label("category"),
            Product.is_active.label("product_is_active"),
            Warehouse.id.label("warehouse_id"),
            Warehouse.name.label("warehouse_name"),
            Warehouse.is_active.label("warehouse_is_active"),
            InventoryLedger.batch_id.label("batch_id"),
            func.coalesce(func.sum(InventoryLedger.qty), Decimal("0")).label("qty"),
            func.coalesce(
                func.sum(InventoryLedger.qty * func.coalesce(InventoryLedger.unit_cost, Decimal("0"))),
                Decimal("0"),
            ).label("stock_value"),
            func.max(InventoryLedger.created_at).label("last_movement_date"),
        )
        .select_from(InventoryLedger)
        .join(Product, Product.id == InventoryLedger.product_id)
        .join(Warehouse, Warehouse.id == InventoryLedger.warehouse_id)
        .group_by(
            Product.id,
            Product.sku,
            Product.name,
            Product.brand,
            Product.hsn,
            Product.is_active,
            Warehouse.id,
            Warehouse.name,
            Warehouse.is_active,
            InventoryLedger.batch_id,
        )
        .having(func.sum(InventoryLedger.qty) != 0)
    )

    if filters.warehouse_ids:
        stmt = stmt.where(InventoryLedger.warehouse_id.in_(filters.warehouse_ids))
    if filters.product_ids:
        stmt = stmt.where(InventoryLedger.product_id.in_(filters.product_ids))
    if filters.brand_values:
        stmt = stmt.where(Product.brand.in_(filters.brand_values))
    if filters.category_values:
        stmt = stmt.where(Product.hsn.in_(filters.category_values))
    if filters.is_active is not None:
        stmt = stmt.where(Product.is_active.is_(filters.is_active))
        stmt = stmt.where(Warehouse.is_active.is_(filters.is_active))

    rows = db.execute(stmt).mappings().all()
    return [dict(row) for row in rows]


def _load_transaction_snapshot(db: Session) -> dict[str, Any]:
    po_rows = db.execute(
        select(
            PurchaseOrder.supplier_id.label("supplier_id"),
            PurchaseOrder.warehouse_id.label("warehouse_id"),
            func.count(PurchaseOrder.id).label("po_count"),
            func.max(PurchaseOrder.order_date).label("last_po_date"),
        ).group_by(PurchaseOrder.supplier_id, PurchaseOrder.warehouse_id)
    ).mappings()

    grn_rows = db.execute(
        select(
            GRN.supplier_id.label("supplier_id"),
            GRN.warehouse_id.label("warehouse_id"),
            func.count(GRN.id).label("grn_count"),
            func.max(GRN.received_date).label("last_grn_date"),
            func.max(GRN.posted_at).label("last_grn_posted_at"),
        ).group_by(GRN.supplier_id, GRN.warehouse_id)
    ).mappings()

    sales_rows = db.execute(
        select(
            SalesOrder.customer_id.label("customer_id"),
            func.max(SalesOrder.order_date).label("last_sales_date"),
        ).group_by(SalesOrder.customer_id)
    ).mappings()

    by_supplier_warehouse: dict[tuple[int | None, int | None], dict[str, Any]] = defaultdict(dict)
    for row in po_rows:
        by_supplier_warehouse[(row["supplier_id"], row["warehouse_id"])].update(dict(row))
    for row in grn_rows:
        by_supplier_warehouse[(row["supplier_id"], row["warehouse_id"])].update(dict(row))

    sales_by_customer: dict[int, Any] = {}
    for row in sales_rows:
        if row["customer_id"] is not None:
            sales_by_customer[int(row["customer_id"])] = row["last_sales_date"]

    return {
        "supplier_warehouse": by_supplier_warehouse,
        "sales_by_customer": sales_by_customer,
    }


def _filtered_parties(db: Session, filters: MasterReportFilters) -> list[Party]:
    stmt = select(Party).order_by(Party.name.asc())
    if filters.party_types:
        stmt = stmt.where(Party.party_type.in_(filters.party_types))
    if filters.party_categories:
        stmt = stmt.where(Party.party_category.in_(filters.party_categories))
    if filters.states:
        stmt = stmt.where(Party.state.in_(filters.states))
    if filters.cities:
        stmt = stmt.where(Party.city.in_(filters.cities))
    if filters.is_active is not None:
        stmt = stmt.where(Party.is_active.is_(filters.is_active))
    return list(db.scalars(stmt))


def _filtered_products(db: Session, filters: MasterReportFilters) -> list[Product]:
    stmt = select(Product).order_by(Product.name.asc())
    if filters.product_ids:
        stmt = stmt.where(Product.id.in_(filters.product_ids))
    if filters.brand_values:
        stmt = stmt.where(Product.brand.in_(filters.brand_values))
    if filters.category_values:
        stmt = stmt.where(Product.hsn.in_(filters.category_values))
    if filters.is_active is not None:
        stmt = stmt.where(Product.is_active.is_(filters.is_active))
    return list(db.scalars(stmt))


def _filtered_warehouses(db: Session, filters: MasterReportFilters) -> list[Warehouse]:
    stmt = select(Warehouse).order_by(Warehouse.name.asc())
    if filters.warehouse_ids:
        stmt = stmt.where(Warehouse.id.in_(filters.warehouse_ids))
    if filters.is_active is not None:
        stmt = stmt.where(Warehouse.is_active.is_(filters.is_active))
    return list(db.scalars(stmt))


def get_warehouse_item_summary_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    positions = _load_stock_positions(db, filters)
    grouped: dict[int, dict[str, Any]] = {}
    for row in positions:
        warehouse_id = int(row["warehouse_id"])
        current = grouped.setdefault(
            warehouse_id,
            {
                "warehouse_name": row["warehouse_name"],
                "warehouse_is_active": row["warehouse_is_active"],
                "sku_ids": set(),
                "batch_ids": set(),
                "total_stock_qty": Decimal("0"),
                "total_stock_value": Decimal("0"),
                "last_stock_movement_date": None,
            },
        )
        current["sku_ids"].add(int(row["product_id"]))
        current["batch_ids"].add(int(row["batch_id"]))
        current["total_stock_qty"] += _decimal(row["qty"])
        current["total_stock_value"] += _decimal(row["stock_value"])
        if row["last_movement_date"] and (
            current["last_stock_movement_date"] is None
            or row["last_movement_date"] > current["last_stock_movement_date"]
        ):
            current["last_stock_movement_date"] = row["last_movement_date"]

    rows = [
        {
            "warehouse_name": value["warehouse_name"],
            "total_skus": len(value["sku_ids"]),
            "total_batches": len(value["batch_ids"]),
            "total_stock_qty": value["total_stock_qty"],
            "total_stock_value": value["total_stock_value"],
            "last_stock_movement_date": value["last_stock_movement_date"],
            "status": "Active" if value["warehouse_is_active"] else "Inactive",
        }
        for value in grouped.values()
    ]
    rows.sort(key=lambda row: str(row["warehouse_name"]).lower())
    total, page_rows = _paginate_rows(rows, filters)
    summary = [
        {"key": "warehouses", "label": "Total Warehouses", "value": len(rows)},
        {"key": "skus", "label": "Total SKUs", "value": sum(int(row["total_skus"]) for row in rows)},
        {
            "key": "qty",
            "label": "Total Stock Qty",
            "value": sum((_decimal(row["total_stock_qty"]) for row in rows), Decimal("0")),
        },
        {
            "key": "value",
            "label": "Total Stock Value",
            "value": sum((_decimal(row["total_stock_value"]) for row in rows), Decimal("0")),
        },
    ]
    return total, page_rows, summary


def get_warehouse_utilization_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    warehouses = _filtered_warehouses(db, filters)
    positions = _load_stock_positions(db, filters)
    transaction_snapshot = _load_transaction_snapshot(db)["supplier_warehouse"]
    per_warehouse_positions: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in positions:
        per_warehouse_positions[int(row["warehouse_id"])].append(row)

    rows: list[dict[str, Any]] = []
    for warehouse in warehouses:
        wh_positions = per_warehouse_positions.get(warehouse.id, [])
        total_skus = len({int(row["product_id"]) for row in wh_positions})
        current_qty = sum((_decimal(row["qty"]) for row in wh_positions), Decimal("0"))
        last_stock_movement = max(
            (row["last_movement_date"] for row in wh_positions if row["last_movement_date"] is not None),
            default=None,
        )

        transaction_count = 0
        last_grn_date = None
        for key, snapshot in transaction_snapshot.items():
            if key[1] != warehouse.id:
                continue
            transaction_count += int(snapshot.get("po_count") or 0) + int(snapshot.get("grn_count") or 0)
            candidate = snapshot.get("last_grn_date")
            if candidate and (last_grn_date is None or candidate > last_grn_date):
                last_grn_date = candidate

        if transaction_count == 0 and current_qty == 0:
            utilization_status = "Unused"
        elif last_stock_movement is not None and last_stock_movement < (
            datetime.now(last_stock_movement.tzinfo) - timedelta(days=filters.inactivity_days)
        ):
            utilization_status = "Low Usage"
        else:
            utilization_status = "Active"

        rows.append(
            {
                "warehouse_name": warehouse.name,
                "total_transactions": transaction_count,
                "last_grn_date": last_grn_date,
                "last_stock_movement_date": last_stock_movement,
                "total_skus": total_skus,
                "current_qty": current_qty,
                "utilization_status": utilization_status,
            }
        )

    rows.sort(key=lambda row: str(row["warehouse_name"]).lower())
    total, page_rows = _paginate_rows(rows, filters)
    summary = [
        {"key": "warehouses", "label": "Total Warehouses", "value": len(rows)},
        {
            "key": "low_usage",
            "label": "Low Usage / Unused",
            "value": sum(1 for row in rows if row["utilization_status"] != "Active"),
        },
        {"key": "transactions", "label": "Total Transactions", "value": sum(int(row["total_transactions"]) for row in rows)},
    ]
    return total, page_rows, summary


def get_low_usage_unused_warehouses_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    total, rows, summary = get_warehouse_utilization_report(db, filters)
    del total
    filtered_rows = [row for row in rows if row["utilization_status"] != "Active"]
    total, page_rows = _paginate_rows(filtered_rows, filters)
    return total, page_rows, summary


def get_warehouse_coverage_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    positions = _load_stock_positions(db, filters)
    grouped: dict[int, dict[str, Any]] = {}
    for row in positions:
        warehouse_id = int(row["warehouse_id"])
        current = grouped.setdefault(
            warehouse_id,
            {
                "warehouse_name": row["warehouse_name"],
                "brands_present": set(),
                "categories_present": set(),
                "product_ids": set(),
                "batch_ids": set(),
            },
        )
        if row["brand"]:
            current["brands_present"].add(str(row["brand"]))
        if row["category"]:
            current["categories_present"].add(str(row["category"]))
        current["product_ids"].add(int(row["product_id"]))
        current["batch_ids"].add(int(row["batch_id"]))

    rows = [
        {
            "warehouse_name": value["warehouse_name"],
            "brands_present": ", ".join(sorted(value["brands_present"])) or "-",
            "categories_present": ", ".join(sorted(value["categories_present"])) or "-",
            "product_count": len(value["product_ids"]),
            "batch_count": len(value["batch_ids"]),
        }
        for value in grouped.values()
    ]
    rows.sort(key=lambda row: str(row["warehouse_name"]).lower())
    total, page_rows = _paginate_rows(rows, filters)
    summary = [
        {"key": "warehouses", "label": "Total Warehouses", "value": len(rows)},
        {"key": "products", "label": "Products Covered", "value": sum(int(row["product_count"]) for row in rows)},
    ]
    return total, page_rows, summary


def get_brand_item_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    products = _filtered_products(db, filters)
    product_ids = tuple(product.id for product in products)
    position_filters = _clone_filters(filters, product_ids=product_ids)
    positions = _load_stock_positions(db, position_filters) if product_ids else []

    product_map: dict[str, list[Product]] = defaultdict(list)
    for product in products:
        product_map[product.brand or "Unbranded"].append(product)

    by_brand_positions: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in positions:
        by_brand_positions[str(row["brand"] or "Unbranded")].append(row)

    rows: list[dict[str, Any]] = []
    for brand, brand_products in product_map.items():
        brand_positions = by_brand_positions.get(brand, [])
        rows.append(
            {
                "brand": brand,
                "item_count": len(brand_products),
                "active_item_count": sum(1 for product in brand_products if product.is_active),
                "warehouses_present_in": len({int(row["warehouse_id"]) for row in brand_positions}),
                "total_stock_qty": sum((_decimal(row["qty"]) for row in brand_positions), Decimal("0")),
                "total_stock_value": sum((_decimal(row["stock_value"]) for row in brand_positions), Decimal("0")),
            }
        )

    rows.sort(key=lambda row: str(row["brand"]).lower())
    total, page_rows = _paginate_rows(rows, filters)
    summary = [
        {"key": "brands", "label": "Total Brands", "value": len(rows)},
        {"key": "items", "label": "Total Active Items", "value": sum(int(row["active_item_count"]) for row in rows)},
    ]
    return total, page_rows, summary


def get_category_item_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    products = _filtered_products(db, filters)
    product_ids = tuple(product.id for product in products)
    positions = _load_stock_positions(db, _clone_filters(filters, product_ids=product_ids)) if product_ids else []

    product_map: dict[str, list[Product]] = defaultdict(list)
    for product in products:
        product_map[product.hsn or "Uncategorised"].append(product)

    by_category_positions: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in positions:
        by_category_positions[str(row["category"] or "Uncategorised")].append(row)

    rows = [
        {
            "category": category,
            "item_count": len(category_products),
            "active_item_count": sum(1 for product in category_products if product.is_active),
            "total_stock_qty": sum((_decimal(row["qty"]) for row in by_category_positions.get(category, [])), Decimal("0")),
            "total_stock_value": sum((_decimal(row["stock_value"]) for row in by_category_positions.get(category, [])), Decimal("0")),
        }
        for category, category_products in product_map.items()
    ]
    rows.sort(key=lambda row: str(row["category"]).lower())
    total, page_rows = _paginate_rows(rows, filters)
    summary = [
        {"key": "categories", "label": "Total Categories", "value": len(rows)},
        {"key": "items", "label": "Total Items", "value": sum(int(row["item_count"]) for row in rows)},
    ]
    return total, page_rows, summary


def get_item_utilization_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    positions = _load_stock_positions(db, filters)
    grouped: dict[int, dict[str, Any]] = {}
    for row in positions:
        product_id = int(row["product_id"])
        current = grouped.setdefault(
            product_id,
            {
                "sku": row["sku"],
                "product_name": row["product_name"],
                "brand": row["brand"],
                "category": row["category"],
                "warehouses_present_in": set(),
                "last_movement_date": None,
                "total_current_qty": Decimal("0"),
            },
        )
        current["warehouses_present_in"].add(int(row["warehouse_id"]))
        current["total_current_qty"] += _decimal(row["qty"])
        if row["last_movement_date"] and (
            current["last_movement_date"] is None or row["last_movement_date"] > current["last_movement_date"]
        ):
            current["last_movement_date"] = row["last_movement_date"]

    rows = [
        {
            "sku": value["sku"],
            "product_name": value["product_name"],
            "brand": value["brand"],
            "category": value["category"],
            "warehouses_present_in": len(value["warehouses_present_in"]),
            "last_movement_date": value["last_movement_date"],
            "total_current_qty": value["total_current_qty"],
        }
        for value in grouped.values()
    ]
    rows.sort(key=lambda row: str(row["product_name"]).lower())
    total, page_rows = _paginate_rows(rows, filters)
    summary = [
        {"key": "items", "label": "Active Items In Use", "value": len(rows)},
        {"key": "qty", "label": "Current Qty", "value": sum((_decimal(row["total_current_qty"]) for row in rows), Decimal("0"))},
    ]
    return total, page_rows, summary


def get_item_distribution_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    positions = _load_stock_positions(db, filters)
    grouped: dict[tuple[int, int], dict[str, Any]] = {}
    for row in positions:
        key = (int(row["product_id"]), int(row["warehouse_id"]))
        current = grouped.setdefault(
            key,
            {
                "sku": row["sku"],
                "product_name": row["product_name"],
                "brand": row["brand"],
                "warehouse": row["warehouse_name"],
                "batch_ids": set(),
                "qty": Decimal("0"),
                "stock_value": Decimal("0"),
            },
        )
        current["batch_ids"].add(int(row["batch_id"]))
        current["qty"] += _decimal(row["qty"])
        current["stock_value"] += _decimal(row["stock_value"])

    rows = [
        {
            "sku": value["sku"],
            "product_name": value["product_name"],
            "brand": value["brand"],
            "warehouse": value["warehouse"],
            "batch_count": len(value["batch_ids"]),
            "qty": value["qty"],
            "stock_value": value["stock_value"],
        }
        for value in grouped.values()
    ]
    rows.sort(key=lambda row: (str(row["product_name"]).lower(), str(row["warehouse"]).lower()))
    total, page_rows = _paginate_rows(rows, filters)
    summary = [
        {"key": "rows", "label": "Distribution Rows", "value": len(rows)},
        {"key": "qty", "label": "Total Qty", "value": sum((_decimal(row["qty"]) for row in rows), Decimal("0"))},
    ]
    return total, page_rows, summary


def _party_activity_maps(db: Session) -> dict[str, Any]:
    purchase_dates = {
        int(row.supplier_id): row.last_purchase_date
        for row in db.execute(
            select(
                PurchaseOrder.supplier_id,
                func.max(PurchaseOrder.order_date).label("last_purchase_date"),
            ).group_by(PurchaseOrder.supplier_id)
        )
        if row.supplier_id is not None
    }
    grn_dates = {
        int(row.supplier_id): row.last_grn_date
        for row in db.execute(
            select(
                GRN.supplier_id,
                func.max(GRN.received_date).label("last_grn_date"),
            ).group_by(GRN.supplier_id)
        )
        if row.supplier_id is not None
    }
    sales_dates = {
        int(row.customer_id): row.last_sales_date
        for row in db.execute(
            select(
                SalesOrder.customer_id,
                func.max(SalesOrder.order_date).label("last_sales_date"),
            ).group_by(SalesOrder.customer_id)
        )
        if row.customer_id is not None
    }
    return {
        "purchase": purchase_dates,
        "grn": grn_dates,
        "sales": sales_dates,
    }


def get_party_type_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    parties = _filtered_parties(db, filters)
    activity_maps = _party_activity_maps(db)
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for party in parties:
        key = (party.party_type, party.party_category or "OTHER")
        current = grouped.setdefault(
            key,
            {
                "party_type": party.party_type,
                "party_category": party.party_category or "OTHER",
                "total_parties": 0,
                "active_parties": 0,
                "states_covered": set(),
                "last_activity_date": None,
            },
        )
        current["total_parties"] += 1
        if party.is_active:
            current["active_parties"] += 1
        if party.state:
            current["states_covered"].add(party.state)

        last_activity = max(
            (
                value
                for value in (
                    activity_maps["purchase"].get(party.id),
                    activity_maps["grn"].get(party.id),
                    activity_maps["sales"].get(party.id),
                )
                if value is not None
            ),
            default=None,
        )
        if last_activity and (
            current["last_activity_date"] is None or last_activity > current["last_activity_date"]
        ):
            current["last_activity_date"] = last_activity

    rows = [
        {
            "party_type": value["party_type"],
            "party_category": value["party_category"],
            "total_parties": value["total_parties"],
            "active_parties": value["active_parties"],
            "states_covered": len(value["states_covered"]),
            "last_activity_date": value["last_activity_date"],
        }
        for value in grouped.values()
    ]
    rows.sort(key=lambda row: (str(row["party_type"]), str(row["party_category"])))
    total, page_rows = _paginate_rows(rows, filters)
    summary = [
        {"key": "parties", "label": "Total Parties", "value": sum(int(row["total_parties"]) for row in rows)},
        {"key": "active", "label": "Active Parties", "value": sum(int(row["active_parties"]) for row in rows)},
    ]
    return total, page_rows, summary


def get_party_geography_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    parties = _filtered_parties(db, filters)
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for party in parties:
        key = (party.state or "Unknown", party.city or "Unknown")
        current = grouped.setdefault(
            key,
            {
                "state": key[0],
                "city": key[1],
                "party_count": 0,
                "supplier_count": 0,
                "customer_count": 0,
                "both_count": 0,
            },
        )
        current["party_count"] += 1
        if party.party_type == "SUPPLIER":
            current["supplier_count"] += 1
        elif party.party_type == "CUSTOMER":
            current["customer_count"] += 1
        else:
            current["both_count"] += 1

    rows = list(grouped.values())
    rows.sort(key=lambda row: (str(row["state"]).lower(), str(row["city"]).lower()))
    total, page_rows = _paginate_rows(rows, filters)
    summary = [
        {"key": "states", "label": "States Covered", "value": len({row["state"] for row in rows})},
        {"key": "parties", "label": "Total Parties", "value": sum(int(row["party_count"]) for row in rows)},
    ]
    return total, page_rows, summary


def get_party_commercial_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    rows = [
        {
            "party_name": party.name,
            "party_type": party.party_type,
            "category": party.party_category,
            "state": party.state,
            "credit_limit": party.credit_limit or Decimal("0"),
            "payment_terms": party.payment_terms or "-",
            "opening_balance": party.opening_balance or Decimal("0"),
            "outstanding_tracking_mode": party.outstanding_tracking_mode or "-",
        }
        for party in _filtered_parties(db, filters)
    ]
    rows.sort(key=lambda row: str(row["party_name"]).lower())
    total, page_rows = _paginate_rows(rows, filters)
    summary = [
        {"key": "parties", "label": "Parties Listed", "value": len(rows)},
        {"key": "credit", "label": "Total Credit Limit", "value": sum((_decimal(row["credit_limit"]) for row in rows), Decimal("0"))},
    ]
    return total, page_rows, summary


def get_party_activity_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    parties = _filtered_parties(db, filters)
    activity_maps = _party_activity_maps(db)
    rows = []
    for party in parties:
        rows.append(
            {
                "party_name": party.name,
                "party_type": party.party_type,
                "category": party.party_category,
                "state": party.state,
                "last_purchase_date": activity_maps["purchase"].get(party.id),
                "last_grn_date": activity_maps["grn"].get(party.id),
                "last_sales_date": activity_maps["sales"].get(party.id),
                "active_flag": "Active" if party.is_active else "Inactive",
            }
        )
    rows.sort(key=lambda row: str(row["party_name"]).lower())
    total, page_rows = _paginate_rows(rows, filters)
    summary = [
        {"key": "parties", "label": "Parties Listed", "value": len(rows)},
        {"key": "active", "label": "Active Parties", "value": sum(1 for row in rows if row["active_flag"] == "Active")},
    ]
    return total, page_rows, summary


def get_inactive_parties_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    inactive_filters = _clone_filters(filters, is_active=False)
    rows = [
        {
            "party_name": party.name,
            "party_type": party.party_type,
            "party_category": party.party_category,
            "state": party.state,
            "city": party.city,
            "gstin": party.gstin,
            "updated_at": party.updated_at,
        }
        for party in _filtered_parties(db, inactive_filters)
    ]
    total, page_rows = _paginate_rows(rows, filters)
    summary = [{"key": "inactive_parties", "label": "Inactive Parties", "value": len(rows)}]
    return total, page_rows, summary


def get_brand_summary_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    total, rows, summary = get_brand_item_report(db, filters)
    for row in rows:
        brand_positions = _load_stock_positions(
            db,
            _clone_filters(filters, brand_values=(str(row["brand"]),)),
        )
        row["warehouse_count"] = len({int(position["warehouse_id"]) for position in brand_positions})
        row["last_movement_date"] = max(
            (position["last_movement_date"] for position in brand_positions if position["last_movement_date"] is not None),
            default=None,
        )
        row["total_qty"] = row.pop("total_stock_qty")
    return total, rows, summary


def get_category_summary_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    total, rows, summary = get_category_item_report(db, filters)
    for row in rows:
        category_positions = _load_stock_positions(
            db,
            _clone_filters(filters, category_values=(str(row["category"]),)),
        )
        row["warehouse_count"] = len({int(position["warehouse_id"]) for position in category_positions})
        row["last_movement_date"] = max(
            (position["last_movement_date"] for position in category_positions if position["last_movement_date"] is not None),
            default=None,
        )
        row["total_qty"] = row.pop("total_stock_qty")
    return total, rows, summary


def get_inactive_items_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    inactive_filters = _clone_filters(filters, is_active=False)
    rows = [
        {
            "sku": product.sku,
            "product_name": product.name,
            "brand": product.brand,
            "category": product.hsn,
            "gst_rate": product.gst_rate,
            "updated_at": product.updated_at,
        }
        for product in _filtered_products(db, inactive_filters)
    ]
    total, page_rows = _paginate_rows(rows, filters)
    summary = [{"key": "inactive_items", "label": "Inactive Items", "value": len(rows)}]
    return total, page_rows, summary


def get_inactive_warehouses_report(
    db: Session,
    filters: MasterReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    inactive_filters = _clone_filters(filters, is_active=False)
    rows = [
        {
            "warehouse_name": warehouse.name,
            "warehouse_code": warehouse.code,
            "address": warehouse.address,
            "updated_at": warehouse.updated_at,
        }
        for warehouse in _filtered_warehouses(db, inactive_filters)
    ]
    total, page_rows = _paginate_rows(rows, filters)
    summary = [{"key": "inactive_warehouses", "label": "Inactive Warehouses", "value": len(rows)}]
    return total, page_rows, summary
