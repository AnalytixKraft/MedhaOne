from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.reports.purchase_analytics.common import (
    PurchaseAnalyticsFilters,
    build_summary_metric,
    load_purchase_order_receipt_records,
    paginate_rows,
    safe_percent,
)


def get_po_fulfillment_quality_report(
    db: Session,
    filters: PurchaseAnalyticsFilters,
) -> tuple[int, list[dict[str, object]], list[dict[str, object]], dict[str, list[dict[str, object]]], dict[str, object]]:
    records = load_purchase_order_receipt_records(db, filters)

    grouped: dict[int, dict[str, object]] = {}
    for record in records:
        bucket = grouped.setdefault(
            record.supplier_id,
            {
                "supplier": record.supplier_name,
                "total_ordered_qty": Decimal("0"),
                "total_received_qty": Decimal("0"),
                "po_count": 0,
                "grn_count": 0,
                "partial_receipt_pos": 0,
                "closed_po_count": 0,
            },
        )
        bucket["total_ordered_qty"] += record.ordered_qty
        bucket["total_received_qty"] += record.received_qty
        bucket["po_count"] += 1
        bucket["grn_count"] += record.grn_count
        bucket["partial_receipt_pos"] += 1 if record.partial_receipt_count > 0 else 0
        bucket["closed_po_count"] += 1 if record.closed else 0

    rows: list[dict[str, object]] = []
    for bucket in grouped.values():
        ordered_qty = bucket["total_ordered_qty"]
        received_qty = bucket["total_received_qty"]
        po_count = max(bucket["po_count"], 1)
        row = {
            "supplier": bucket["supplier"],
            "total_ordered_qty": ordered_qty,
            "total_received_qty": received_qty,
            "fill_rate_pct": safe_percent(received_qty, ordered_qty),
            "under_receipt_pct": safe_percent(max(ordered_qty - received_qty, Decimal("0")), ordered_qty),
            "over_receipt_pct": safe_percent(max(received_qty - ordered_qty, Decimal("0")), ordered_qty),
            "avg_grn_count_per_po": round(bucket["grn_count"] / po_count, 2),
            "partial_receipt_frequency": safe_percent(
                Decimal(str(bucket["partial_receipt_pos"])),
                Decimal(str(po_count)),
            ),
            "closed_po_count": bucket["closed_po_count"],
            "po_closure_rate": safe_percent(
                Decimal(str(bucket["closed_po_count"])),
                Decimal(str(po_count)),
            ),
        }
        rows.append(row)

    rows.sort(key=lambda row: (-float(row["fill_rate_pct"]), row["supplier"]))
    total, paged_rows = paginate_rows(rows, page=filters.page, page_size=filters.page_size)

    summary: list[dict[str, object]] = []
    if rows:
        total_ordered = sum((row["total_ordered_qty"] for row in rows), Decimal("0"))
        total_received = sum((row["total_received_qty"] for row in rows), Decimal("0"))
        best_supplier = rows[0]["supplier"]
        summary = [
            build_summary_metric("ordered_qty", "Ordered Qty", total_ordered),
            build_summary_metric("received_qty", "Received Qty", total_received),
            build_summary_metric("fill_rate_pct", "Fill Rate %", safe_percent(total_received, total_ordered)),
            build_summary_metric(
                "avg_grn_splits_per_po",
                "Avg GRN Splits per PO",
                round(sum(float(row["avg_grn_count_per_po"]) for row in rows) / len(rows), 2),
            ),
            build_summary_metric(
                "po_closure_rate",
                "PO Closure Rate",
                safe_percent(
                    Decimal(str(sum(int(row["closed_po_count"]) for row in rows))),
                    Decimal(str(sum(record.po_id is not None for record in records) or 1)),
                ),
            ),
            build_summary_metric("best_fill_supplier", "Best Fill Supplier", best_supplier),
        ]

    return total, paged_rows, summary, {"bar": rows}, {}
