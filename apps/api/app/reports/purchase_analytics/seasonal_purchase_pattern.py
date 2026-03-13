from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy.orm import Session

from app.reports.purchase_analytics.common import (
    PurchaseAnalyticsFilters,
    build_summary_metric,
    format_month_label,
    load_purchase_events,
    paginate_rows,
    safe_percent,
    to_decimal,
)


def get_seasonal_purchase_pattern_report(
    db: Session,
    filters: PurchaseAnalyticsFilters,
) -> tuple[int, list[dict[str, object]], list[dict[str, object]], dict[str, list[dict[str, object]]], dict[str, object]]:
    events = load_purchase_events(db, filters)

    product_months: dict[tuple[int, int], dict[str, object]] = {}
    overall_months: dict[int, dict[str, object]] = {}
    heatmap_rows: dict[int, dict[str, object]] = {}

    for event in events:
        key = (event.product_id, event.source_date.month)
        month_name = format_month_label(event.source_date.year, event.source_date.month)
        bucket = product_months.setdefault(
            key,
            {
                "product": event.product_name,
                "brand": event.brand or "-",
                "month": month_name,
                "month_number": event.source_date.month,
                "purchase_qty": Decimal("0"),
                "purchase_value": Decimal("0"),
                "peak_month_flag": False,
            },
        )
        bucket["purchase_qty"] = to_decimal(bucket["purchase_qty"]) + event.qty
        bucket["purchase_value"] = to_decimal(bucket["purchase_value"]) + event.value

        overall = overall_months.setdefault(
            event.source_date.month,
            {
                "month": format_month_label(filters.year or event.source_date.year, event.source_date.month),
                "month_number": event.source_date.month,
                "purchase_qty": Decimal("0"),
                "purchase_value": Decimal("0"),
            },
        )
        overall["purchase_qty"] = to_decimal(overall["purchase_qty"]) + event.qty
        overall["purchase_value"] = to_decimal(overall["purchase_value"]) + event.value

        heatmap = heatmap_rows.setdefault(
            event.product_id,
            {
                "product": event.product_name,
                "brand": event.brand or "-",
            },
        )
        heatmap[f"month_{event.source_date.month}"] = float(
            Decimal(str(heatmap.get(f"month_{event.source_date.month}", 0))) + event.qty
        )

    peak_by_product: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for bucket in product_months.values():
        peak_by_product[bucket["product"]] = max(
            peak_by_product[bucket["product"]],
            to_decimal(bucket["purchase_qty"]),
        )

    rows: list[dict[str, object]] = []
    seasonality_scores: list[Decimal] = []
    totals_by_product: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    counts_by_product: dict[str, int] = defaultdict(int)
    for bucket in product_months.values():
        qty = to_decimal(bucket["purchase_qty"])
        product = str(bucket["product"])
        totals_by_product[product] += qty
        counts_by_product[product] += 1
        bucket["peak_month_flag"] = qty == peak_by_product[product]
        rows.append(bucket)

    for product, total_qty in totals_by_product.items():
        average_monthly = total_qty / Decimal(str(max(counts_by_product[product], 1)))
        seasonality_scores.append(
            safe_percent(peak_by_product[product] - average_monthly, average_monthly)
            if average_monthly
            else Decimal("0")
        )

    rows.sort(key=lambda row: (row["product"], row["month_number"]))
    total, paged_rows = paginate_rows(rows, page=filters.page, page_size=filters.page_size)

    bar_chart = sorted(
        [
            {
                "month": payload["month"],
                "month_number": payload["month_number"],
                "purchase_qty": float(to_decimal(payload["purchase_qty"])),
                "purchase_value": float(to_decimal(payload["purchase_value"])),
            }
            for payload in overall_months.values()
        ],
        key=lambda row: row["month_number"],
    )

    summary: list[dict[str, object]] = []
    if events:
        top_purchase_month = max(
            overall_months.values(),
            key=lambda item: to_decimal(item["purchase_qty"]),
        )
        total_qty = sum((event.qty for event in events), Decimal("0"))
        total_value = sum((event.value for event in events), Decimal("0"))
        average_monthly_purchase = (
            total_qty / Decimal(str(max(len(overall_months), 1)))
            if overall_months
            else Decimal("0")
        )
        summary = [
            build_summary_metric("monthly_purchase_qty", "Monthly Purchase Qty", total_qty),
            build_summary_metric("monthly_purchase_value", "Monthly Purchase Value", total_value),
            build_summary_metric("top_purchase_month", "Top Purchase Month", top_purchase_month["month"]),
            build_summary_metric(
                "average_monthly_purchase",
                "Average Monthly Purchase",
                average_monthly_purchase,
            ),
            build_summary_metric(
                "seasonality_score",
                "Seasonality Score",
                max(seasonality_scores) if seasonality_scores else Decimal("0"),
            ),
        ]

    meta = {
        "month_columns": [
            {"key": f"month_{month}", "label": format_month_label(filters.year or 2026, month)}
            for month in range(1, 13)
        ]
    }

    return total, paged_rows, summary, {"bar": bar_chart, "heatmap": list(heatmap_rows.values())}, meta
