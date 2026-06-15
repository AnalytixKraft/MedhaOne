from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy.orm import Session

from app.reports.purchase_analytics.common import (
    PurchaseAnalyticsFilters,
    build_summary_metric,
    load_purchase_events,
    paginate_rows,
    safe_percent,
    to_decimal,
)


def get_supplier_price_comparison_report(
    db: Session,
    filters: PurchaseAnalyticsFilters,
) -> tuple[int, list[dict[str, object]], list[dict[str, object]], dict[str, list[dict[str, object]]], dict[str, object]]:
    events = load_purchase_events(db, filters)

    grouped: dict[tuple[int, int | None], dict[str, object]] = {}
    by_product: dict[int, list[dict[str, object]]] = defaultdict(list)
    line_history: dict[str, dict[str, object]] = {}

    for event in events:
        key = (event.product_id, event.supplier_id)
        bucket = grouped.setdefault(
            key,
            {
                "product": event.product_name,
                "supplier": event.supplier_name,
                "last_purchase_rate": event.unit_rate,
                "avg_purchase_rate": Decimal("0"),
                "lowest_rate": event.unit_rate,
                "highest_rate": event.unit_rate,
                "variance_pct": Decimal("0"),
                "rank": 0,
                "_latest_date": event.source_date,
                "_total_qty": Decimal("0"),
                "_total_value": Decimal("0"),
            },
        )
        bucket["_total_qty"] += event.qty
        bucket["_total_value"] += event.value
        bucket["lowest_rate"] = min(to_decimal(bucket["lowest_rate"]), event.unit_rate)
        bucket["highest_rate"] = max(to_decimal(bucket["highest_rate"]), event.unit_rate)
        if event.source_date >= bucket["_latest_date"]:
            bucket["_latest_date"] = event.source_date
            bucket["last_purchase_rate"] = event.unit_rate

        history_bucket = line_history.setdefault(
            event.month_key,
            {"month": event.month_label, "month_sort": event.month_key},
        )
        history_bucket[f"supplier_{event.supplier_id or 0}"] = float(event.unit_rate)

    for (product_id, _supplier_id), bucket in grouped.items():
        total_qty = to_decimal(bucket["_total_qty"])
        total_value = to_decimal(bucket["_total_value"])
        bucket["avg_purchase_rate"] = total_value / total_qty if total_qty else Decimal("0")
        bucket.pop("_latest_date", None)
        bucket.pop("_total_qty", None)
        bucket.pop("_total_value", None)
        by_product[product_id].append(bucket)

    rows: list[dict[str, object]] = []
    cheapest_supplier = None
    most_expensive_supplier = None
    for product_rows in by_product.values():
        product_rows.sort(key=lambda row: (to_decimal(row["avg_purchase_rate"]), row["supplier"]))
        cheapest_rate = to_decimal(product_rows[0]["avg_purchase_rate"]) if product_rows else Decimal("0")
        for index, row in enumerate(product_rows, start=1):
            row["rank"] = index
            row["variance_pct"] = safe_percent(
                to_decimal(row["avg_purchase_rate"]) - cheapest_rate,
                cheapest_rate,
            )
            rows.append(row)
        if product_rows:
            cheapest_supplier = cheapest_supplier or product_rows[0]["supplier"]
            most_expensive_supplier = product_rows[-1]["supplier"]

    rows.sort(key=lambda row: (row["product"], row["rank"], row["supplier"]))
    total, paged_rows = paginate_rows(rows, page=filters.page, page_size=filters.page_size)

    summary: list[dict[str, object]] = []
    if rows:
        all_avg_rates = [to_decimal(row["avg_purchase_rate"]) for row in rows]
        summary = [
            build_summary_metric("last_purchase_rate", "Last Purchase Rate", rows[0]["last_purchase_rate"]),
            build_summary_metric(
                "average_purchase_rate",
                "Average Purchase Rate",
                sum(all_avg_rates, Decimal("0")) / Decimal(str(len(all_avg_rates))),
            ),
            build_summary_metric("lowest_historical_rate", "Lowest Historical Rate", min(to_decimal(row["lowest_rate"]) for row in rows)),
            build_summary_metric("highest_historical_rate", "Highest Historical Rate", max(to_decimal(row["highest_rate"]) for row in rows)),
            build_summary_metric(
                "variance_pct",
                "Variance %",
                max((to_decimal(row["variance_pct"]) for row in rows), default=Decimal("0")),
            ),
            build_summary_metric("cheapest_supplier", "Cheapest Supplier", cheapest_supplier),
            build_summary_metric("most_expensive_supplier", "Most Expensive Supplier", most_expensive_supplier),
        ]

    meta = {
        "line_keys": [
            {"key": key, "label": next((event.supplier_name for event in events if f"supplier_{event.supplier_id or 0}" == key), key)}
            for key in sorted({column for row in line_history.values() for column in row.keys() if column.startswith("supplier_")})
        ]
    }

    return total, paged_rows, summary, {"bar": rows, "trend": sorted(line_history.values(), key=lambda row: row["month_sort"])}, meta
