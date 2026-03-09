from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.inventory import StockSummary
from app.models.party import Party
from app.models.product import Product
from app.models.purchase import PurchaseOrder
from app.models.purchase_bill import PurchaseBill
from app.models.warehouse import Warehouse


@dataclass(slots=True)
class DataQualityReportFilters:
    entity_types: tuple[str, ...] = ()
    missing_field_type: str | None = None
    duplicate_type: str | None = None
    compliance_type: str | None = None
    page: int = 1
    page_size: int = 50


def _paginate_rows(
    rows: list[dict[str, Any]],
    filters: DataQualityReportFilters,
) -> tuple[int, list[dict[str, Any]]]:
    total = len(rows)
    start = max(filters.page - 1, 0) * filters.page_size
    return total, rows[start : start + filters.page_size]


def get_missing_fields_report(
    db: Session,
    filters: DataQualityReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    if not filters.entity_types or "PARTY" in filters.entity_types:
        for party in db.scalars(select(Party).order_by(Party.name.asc())):
            missing = []
            if not party.gstin:
                missing.append("gstin")
            if not party.state:
                missing.append("state")
            if not party.contact_person:
                missing.append("contact_person")
            if missing:
                rows.append(
                    {
                        "entity_type": "PARTY",
                        "entity_name": party.name,
                        "entity_id": party.id,
                        "missing_fields": ", ".join(missing),
                    }
                )
    if not filters.entity_types or "PRODUCT" in filters.entity_types:
        for product in db.scalars(select(Product).order_by(Product.name.asc())):
            missing = []
            if not product.brand:
                missing.append("brand")
            if not product.hsn:
                missing.append("category")
            if product.gst_rate is None:
                missing.append("gst_rate")
            if missing:
                rows.append(
                    {
                        "entity_type": "PRODUCT",
                        "entity_name": product.name,
                        "entity_id": product.id,
                        "missing_fields": ", ".join(missing),
                    }
                )
    if not filters.entity_types or "WAREHOUSE" in filters.entity_types:
        for warehouse in db.scalars(select(Warehouse).order_by(Warehouse.name.asc())):
            if not warehouse.address:
                rows.append(
                    {
                        "entity_type": "WAREHOUSE",
                        "entity_name": warehouse.name,
                        "entity_id": warehouse.id,
                        "missing_fields": "address",
                    }
                )

    if filters.missing_field_type:
        rows = [row for row in rows if filters.missing_field_type in str(row["missing_fields"]).split(", ")]
    total, page_rows = _paginate_rows(rows, filters)
    summary = [{"key": "rows", "label": "Records With Missing Fields", "value": len(rows)}]
    return total, page_rows, summary


def get_duplicate_masters_report(
    db: Session,
    filters: DataQualityReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    duplicate_modes = set(filters.duplicate_type.split(",")) if filters.duplicate_type else set()
    if not filters.entity_types or "PARTY" in filters.entity_types:
        if not duplicate_modes or "party_gstin" in duplicate_modes:
            for row in db.execute(
                select(Party.gstin, func.count(Party.id).label("count"))
                .where(Party.gstin.isnot(None))
                .group_by(Party.gstin)
                .having(func.count(Party.id) > 1)
            ).mappings():
                rows.append(
                    {
                        "entity_type": "PARTY",
                        "duplicate_type": "party_gstin",
                        "duplicate_value": row["gstin"],
                        "record_count": row["count"],
                    }
                )
    if not filters.entity_types or "PRODUCT" in filters.entity_types:
        if not duplicate_modes or "product_name" in duplicate_modes:
            for row in db.execute(
                select(Product.name, func.count(Product.id).label("count"))
                .group_by(Product.name)
                .having(func.count(Product.id) > 1)
            ).mappings():
                rows.append(
                    {
                        "entity_type": "PRODUCT",
                        "duplicate_type": "product_name",
                        "duplicate_value": row["name"],
                        "record_count": row["count"],
                    }
                )
    if not filters.entity_types or "WAREHOUSE" in filters.entity_types:
        if not duplicate_modes or "warehouse_name" in duplicate_modes:
            for row in db.execute(
                select(Warehouse.name, func.count(Warehouse.id).label("count"))
                .group_by(Warehouse.name)
                .having(func.count(Warehouse.id) > 1)
            ).mappings():
                rows.append(
                    {
                        "entity_type": "WAREHOUSE",
                        "duplicate_type": "warehouse_name",
                        "duplicate_value": row["name"],
                        "record_count": row["count"],
                    }
                )
    total, page_rows = _paginate_rows(rows, filters)
    summary = [{"key": "rows", "label": "Duplicate Groups", "value": len(rows)}]
    return total, page_rows, summary


def get_compliance_gaps_report(
    db: Session,
    filters: DataQualityReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    gap = filters.compliance_type
    for party in db.scalars(select(Party).order_by(Party.name.asc())):
        gaps = []
        if not party.gstin:
            gaps.append("missing_gstin")
        if not party.pan_number:
            gaps.append("missing_pan")
        if not party.drug_license_number:
            gaps.append("missing_drug_license")
        if not party.fssai_number:
            gaps.append("missing_fssai")
        if gaps:
            rows.append(
                {
                    "entity_type": "PARTY",
                    "entity_name": party.name,
                    "entity_id": party.id,
                    "compliance_gaps": ", ".join(gaps),
                }
            )
    if gap:
        rows = [row for row in rows if gap in str(row["compliance_gaps"]).split(", ")]
    total, page_rows = _paginate_rows(rows, filters)
    summary = [{"key": "rows", "label": "Compliance Gaps", "value": len(rows)}]
    return total, page_rows, summary


def get_invalid_references_report(
    db: Session,
    filters: DataQualityReportFilters,
) -> tuple[int, list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    for row in db.execute(
        select(
            StockSummary.id,
            Product.name.label("product_name"),
            Warehouse.name.label("warehouse_name"),
            Product.is_active.label("product_is_active"),
            Warehouse.is_active.label("warehouse_is_active"),
        )
        .join(Product, Product.id == StockSummary.product_id)
        .join(Warehouse, Warehouse.id == StockSummary.warehouse_id)
        .where((Product.is_active.is_(False)) | (Warehouse.is_active.is_(False)))
    ).mappings():
        rows.append(
            {
                "entity_type": "STOCK_SUMMARY",
                "entity_id": row["id"],
                "reference_issue": "inactive_master_reference",
                "details": f"{row['product_name']} / {row['warehouse_name']}",
            }
        )

    for row in db.execute(
        select(
            PurchaseOrder.id,
            Party.name.label("supplier_name"),
            Warehouse.name.label("warehouse_name"),
        )
        .join(Party, Party.id == PurchaseOrder.supplier_id)
        .join(Warehouse, Warehouse.id == PurchaseOrder.warehouse_id)
        .where((Party.is_active.is_(False)) | (Warehouse.is_active.is_(False)))
    ).mappings():
        rows.append(
            {
                "entity_type": "PURCHASE_ORDER",
                "entity_id": row["id"],
                "reference_issue": "inactive_master_reference",
                "details": f"{row['supplier_name']} / {row['warehouse_name']}",
            }
        )

    for row in db.execute(
        select(PurchaseBill.id, Warehouse.name.label("warehouse_name"))
        .join(Warehouse, Warehouse.id == PurchaseBill.warehouse_id)
        .where(Warehouse.is_active.is_(False))
    ).mappings():
        rows.append(
            {
                "entity_type": "PURCHASE_BILL",
                "entity_id": row["id"],
                "reference_issue": "inactive_master_reference",
                "details": row["warehouse_name"],
            }
        )

    total, page_rows = _paginate_rows(rows, filters)
    summary = [{"key": "rows", "label": "Invalid References", "value": len(rows)}]
    return total, page_rows, summary
