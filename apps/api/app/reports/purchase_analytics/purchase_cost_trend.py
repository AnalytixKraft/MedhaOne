from __future__ import annotations

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


def get_purchase_cost_trend_report(
    db: Session,
    filters: PurchaseAnalyticsFilters,
) -> tuple[int, list[dict[str, object]], list[dict[str, object]], dict[str, list[dict[str, object]]], dict[str, object]]:
    events = load_purchase_events(db, filters)

    grouped: dict[tuple[int, str, int | None, str, str], dict[str, object]] = {}
    overall_months: dict[str, dict[str, Decimal | int | str]] = {}
    supplier_line_map: dict[int | None, str] = {}

    for event in events:
        key = (
            event.product_id,
            event.product_name,
            event.supplier_id,
            event.supplier_name,
            event.month_key,
        )
        bucket = grouped.setdefault(
            key,
            {
                "product": event.product_name,
                "supplier": event.supplier_name,
                "month": event.month_label,
                "month_key": event.month_key,
                "avg_purchase_rate": Decimal("0"),
                "last_purchase_rate": event.unit_rate,
                "purchase_qty": Decimal("0"),
                "purchase_value": Decimal("0"),
                "_latest_date": event.source_date,
            },
        )
        bucket["purchase_qty"] = to_decimal(bucket["purchase_qty"]) + event.qty
        bucket["purchase_value"] = to_decimal(bucket["purchase_value"]) + event.value
        if event.source_date >= bucket["_latest_date"]:
            bucket["_latest_date"] = event.source_date
            bucket["last_purchase_rate"] = event.unit_rate

        month_bucket = overall_months.setdefault(
            event.month_key,
            {
                "month": event.month_label,
                "month_sort": event.month_key,
                "purchase_qty": Decimal("0"),
                "purchase_value": Decimal("0"),
            },
        )
        month_bucket["purchase_qty"] = to_decimal(month_bucket["purchase_qty"]) + event.qty
        month_bucket["purchase_value"] = to_decimal(month_bucket["purchase_value"]) + event.value

        supplier_line_map.setdefault(event.supplier_id, f"supplier_{event.supplier_id or 0}")
        month_bucket[supplier_line_map[event.supplier_id]] = float(event.unit_rate)

    rows: list[dict[str, object]] = []
    for bucket in grouped.values():
        qty = to_decimal(bucket["purchase_qty"])
        value = to_decimal(bucket["purchase_value"])
        bucket["avg_purchase_rate"] = value / qty if qty else Decimal("0")
        bucket.pop("_latest_date", None)
        rows.append(bucket)

    rows.sort(key=lambda row: (row["month_key"], row["product"], row["supplier"]))
    total, paged_rows = paginate_rows(rows, page=filters.page, page_size=filters.page_size)

    overall_chart = sorted(
        [
            {
                "month": payload["month"],
                "month_sort": payload["month_sort"],
                "avg_purchase_rate": float(
                    to_decimal(payload["purchase_value"]) / to_decimal(payload["purchase_qty"])
                )
                if to_decimal(payload["purchase_qty"])
                else 0,
            }
            | {
                key: value
                for key, value in payload.items()
                if key.startswith("supplier_")
            }
            for payload in overall_months.values()
        ],
        key=lambda row: row["month_sort"],
    )

    summary: list[dict[str, object]] = []
    if events:
        earliest_rate = Decimal(str(overall_chart[0]["avg_purchase_rate"]))
        latest_rate = Decimal(str(overall_chart[-1]["avg_purchase_rate"]))
        total_qty = sum((event.qty for event in events), Decimal("0"))
        total_value = sum((event.value for event in events), Decimal("0"))
        summary = [
            build_summary_metric("last_purchase_rate", "Last Purchase Rate", events[-1].unit_rate),
            build_summary_metric(
                "average_purchase_rate",
                "Average Purchase Rate",
                total_value / total_qty if total_qty else Decimal("0"),
            ),
            build_summary_metric("min_purchase_rate", "Min Purchase Rate", min(event.unit_rate for event in events)),
            build_summary_metric("max_purchase_rate", "Max Purchase Rate", max(event.unit_rate for event in events)),
            build_summary_metric(
                "rate_change_pct",
                "Rate Change %",
                safe_percent(latest_rate - earliest_rate, earliest_rate),
            ),
            build_summary_metric("total_purchase_qty", "Total Purchase Qty", total_qty),
            build_summary_metric("total_purchase_value", "Total Purchase Value", total_value),
        ]

    meta = {
        "line_keys": [{"key": "avg_purchase_rate", "label": "Overall"}]
        + [
            {"key": line_key, "label": supplier_name}
            for supplier_id, line_key in supplier_line_map.items()
            for supplier_name in {
                next(
                    event.supplier_name
                    for event in events
                    if event.supplier_id == supplier_id
                )
            }
        ]
    }

    return total, paged_rows, summary, {"trend": overall_chart}, meta
