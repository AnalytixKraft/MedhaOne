from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.reports.purchase_analytics.common import (
    PurchaseAnalyticsFilters,
    build_summary_metric,
    load_purchase_order_receipt_records,
    paginate_rows,
)


def get_supplier_lead_time_report(
    db: Session,
    filters: PurchaseAnalyticsFilters,
) -> tuple[int, list[dict[str, object]], list[dict[str, object]], dict[str, list[dict[str, object]]], dict[str, object]]:
    records = load_purchase_order_receipt_records(db, filters)

    grouped: dict[int, dict[str, object]] = {}
    on_time_count = 0
    delayed_count = 0
    for record in records:
        bucket = grouped.setdefault(
            record.supplier_id,
            {
                "supplier": record.supplier_name,
                "days_to_first": [],
                "days_to_full": [],
                "total_pos": 0,
                "partial_receipt_count": 0,
                "total_received_qty": Decimal("0"),
            },
        )
        bucket["total_pos"] += 1
        bucket["partial_receipt_count"] += 1 if record.partial_receipt_count > 0 else 0
        bucket["total_received_qty"] += record.received_qty
        if record.first_grn_date is not None:
            bucket["days_to_first"].append((record.first_grn_date - record.order_date).days)
        if record.full_receipt_date is not None:
            bucket["days_to_full"].append((record.full_receipt_date - record.order_date).days)
        if record.on_time is True:
            on_time_count += 1
        if record.delayed is True:
            delayed_count += 1

    rows: list[dict[str, object]] = []
    scatter: list[dict[str, object]] = []
    for bucket in grouped.values():
        avg_days_to_first = (
            sum(bucket["days_to_first"]) / len(bucket["days_to_first"])
            if bucket["days_to_first"]
            else 0
        )
        avg_days_to_full = (
            sum(bucket["days_to_full"]) / len(bucket["days_to_full"])
            if bucket["days_to_full"]
            else 0
        )
        row = {
            "supplier": bucket["supplier"],
            "avg_days_to_first_grn": round(avg_days_to_first, 2),
            "avg_days_to_full_receipt": round(avg_days_to_full, 2),
            "total_pos": bucket["total_pos"],
            "partial_receipt_count": bucket["partial_receipt_count"],
            "total_received_qty": bucket["total_received_qty"],
        }
        rows.append(row)
        scatter.append(
            {
                "supplier": bucket["supplier"],
                "avg_days_to_first_grn": round(avg_days_to_first, 2),
                "total_received_qty": float(bucket["total_received_qty"]),
            }
        )

    rows.sort(key=lambda row: (row["avg_days_to_first_grn"], row["supplier"]))
    total, paged_rows = paginate_rows(rows, page=filters.page, page_size=filters.page_size)

    summary: list[dict[str, object]] = []
    if rows:
        overall_first = sum((Decimal(str(row["avg_days_to_first_grn"])) for row in rows), Decimal("0")) / Decimal(
            str(len(rows))
        )
        overall_full = sum((Decimal(str(row["avg_days_to_full_receipt"])) for row in rows), Decimal("0")) / Decimal(
            str(len(rows))
        )
        summary = [
            build_summary_metric("avg_days_to_first_grn", "Avg Days to First GRN", round(overall_first, 2)),
            build_summary_metric("avg_days_to_full_receipt", "Avg Days to Full Receipt", round(overall_full, 2)),
            build_summary_metric("total_pos", "Total POs", sum(int(row["total_pos"]) for row in rows)),
            build_summary_metric("total_received_qty", "Total Received Qty", sum((row["total_received_qty"] for row in rows), Decimal("0"))),
            build_summary_metric("on_time_receipts", "On-Time Receipts", on_time_count),
            build_summary_metric("delayed_receipts", "Delayed Receipts", delayed_count),
        ]

    return total, paged_rows, summary, {"bar": rows, "scatter": scatter}, {}
