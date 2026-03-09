from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.audit import AuditLog
from app.models.brand import Brand
from app.models.enums import (
    InventoryReason,
    PartyType,
    PurchaseBillExtractionStatus,
    PurchaseBillStatus,
)
from app.models.inventory import InventoryLedger, StockSummary
from app.models.purchase_bill import PurchaseBill, PurchaseBillLine
from app.models.role import Role
from app.models.user import User


def _error_payload(response) -> dict[str, str]:
    data = response.json()
    if "error_code" in data:
        return data
    detail = data.get("detail")
    if isinstance(detail, dict):
        return detail
    return {"message": str(detail)}


def _create_access_user(db: Session) -> str:
    role = Role(name="admin", is_active=True)
    db.add(role)
    db.flush()

    user = User(
        email="purchase-admin@medhaone.app",
        full_name="Purchase Admin",
        hashed_password="not-used",
        is_active=True,
        is_superuser=True,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token(str(user.id))


def _valid_test_gstin(seed: str) -> str:
    serial = (sum(ord(char) for char in seed) % 9000) + 1000
    suffix = chr(65 + (sum(ord(char) for char in seed) % 26))
    return f"27ABCDE{serial:04d}{suffix}1Z5"


def _create_supplier(client: TestClient, headers: dict[str, str], code_suffix: str = "01") -> int:
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "name": f"Supplier {code_suffix}",
            "party_type": PartyType.DISTRIBUTOR.value,
            "gstin": _valid_test_gstin(code_suffix),
            "state": "Maharashtra",
            "phone": "9999999999",
            "is_active": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_warehouse(client: TestClient, headers: dict[str, str], code: str = "POWH01") -> int:
    response = client.post(
        "/masters/warehouses",
        headers=headers,
        json={"name": f"Warehouse {code}", "code": code, "address": "A", "is_active": True},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_product(client: TestClient, headers: dict[str, str], sku: str = "PO-SKU-1") -> int:
    brand_response = client.post(
        "/masters/brands",
        headers=headers,
        json={"name": "AK", "is_active": True},
    )
    assert brand_response.status_code in (201, 400), brand_response.text
    response = client.post(
        "/masters/products",
        headers=headers,
        json={"sku": sku, "name": f"Product {sku}", "brand": "AK", "uom": "BOX", "is_active": True},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_po(
    client: TestClient,
    headers: dict[str, str],
    *,
    supplier_id: int,
    warehouse_id: int,
    lines: list[dict[str, str | int]],
) -> dict:
    response = client.post(
        "/purchase/po",
        headers=headers,
        json={
            "supplier_id": supplier_id,
            "warehouse_id": warehouse_id,
            "order_date": "2026-02-27",
            "lines": lines,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _approve_po(client: TestClient, headers: dict[str, str], po_id: int) -> dict:
    response = client.post(f"/purchase/po/{po_id}/approve", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _create_grn(
    client: TestClient,
    headers: dict[str, str],
    po_id: int,
    *,
    lines: list[dict[str, str | int]],
    warehouse_id: int | None = None,
    supplier_id: int | None = None,
) -> dict:
    payload: dict[str, object] = {"lines": lines}
    if warehouse_id is not None:
        payload["warehouse_id"] = warehouse_id
    if supplier_id is not None:
        payload["supplier_id"] = supplier_id

    response = client.post(
        f"/purchase/grn/from-po/{po_id}",
        headers=headers,
        json=payload,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _post_grn(client: TestClient, headers: dict[str, str], grn_id: int) -> dict:
    response = client.post(f"/purchase/grn/{grn_id}/post", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _seed_purchase_bill(
    db: Session,
    *,
    created_by: int,
    supplier_id: int,
    warehouse_id: int,
    purchase_order_id: int | None,
    product_id: int,
    qty: str,
    bill_number: str,
    supplier_gstin: str | None = None,
) -> PurchaseBill:
    qty_decimal = Decimal(qty)
    unit_price = Decimal("10.00")
    taxable_value = qty_decimal * unit_price
    purchase_bill = PurchaseBill(
        bill_number=bill_number,
        supplier_id=supplier_id,
        supplier_gstin=supplier_gstin,
        bill_date=date(2026, 3, 8),
        warehouse_id=warehouse_id,
        status=PurchaseBillStatus.DRAFT,
        subtotal=taxable_value,
        discount_amount=Decimal("0"),
        taxable_value=taxable_value,
        cgst_amount=Decimal("0"),
        sgst_amount=Decimal("0"),
        igst_amount=Decimal("0"),
        adjustment=Decimal("0"),
        total=taxable_value,
        extraction_status=PurchaseBillExtractionStatus.REVIEWED,
        purchase_order_id=purchase_order_id,
        created_by=created_by,
    )
    purchase_bill.lines.append(
        PurchaseBillLine(
            product_id=product_id,
            description_raw=f"Bill line for product {product_id}",
            qty=qty_decimal,
            unit="BOX",
            unit_price=unit_price,
            discount_amount=Decimal("0"),
            gst_percent=Decimal("0"),
            line_total=taxable_value,
        )
    )
    db.add(purchase_bill)
    db.commit()
    db.refresh(purchase_bill)
    return purchase_bill


def test_purchase_to_grn_end_to_end(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "E2E")
    warehouse_id = _create_warehouse(client, headers, "E2EWH")
    product_id = _create_product(client, headers, "E2E-SKU-1")

    po_data = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[
            {
                "product_id": product_id,
                "ordered_qty": "10",
                "unit_cost": "12.50",
                "free_qty": "0",
            }
        ],
    )
    po_id = po_data["id"]
    po_line_id = po_data["lines"][0]["id"]

    approved = _approve_po(client, headers, po_id)
    assert approved["status"] == "APPROVED"

    grn_data = _create_grn(
        client,
        headers,
        po_id,
        lines=[
            {
                "po_line_id": po_line_id,
                "received_qty": "10",
                "free_qty": "0",
                "batch_no": "BATCH-E2E-1",
                "expiry_date": "2030-12-31",
            }
        ],
    )
    grn_id = grn_data["id"]
    grn_number = grn_data["grn_number"]
    posted = _post_grn(client, headers, grn_id)
    assert posted["status"] == "POSTED"
    batch_id = posted["lines"][0]["batch_lines"][0]["batch_id"]

    po_get = client.get(f"/purchase/po/{po_id}", headers=headers)
    assert po_get.status_code == 200
    assert po_get.json()["status"] == "CLOSED"
    assert Decimal(str(po_get.json()["lines"][0]["received_qty"])) == Decimal("10")

    summary = (
        db.query(StockSummary)
        .filter(StockSummary.warehouse_id == warehouse_id)
        .filter(StockSummary.product_id == product_id)
        .filter(StockSummary.batch_id == batch_id)
        .first()
    )
    assert summary is not None
    assert Decimal(str(summary.qty_on_hand)) == Decimal("10")

    ledger_rows = (
        db.query(InventoryLedger)
        .filter(InventoryLedger.reason == InventoryReason.PURCHASE_GRN)
        .filter(InventoryLedger.ref_type == "GRN")
        .filter(InventoryLedger.ref_id == grn_number)
        .all()
    )
    assert len(ledger_rows) == 1
    assert Decimal(str(ledger_rows[0].qty)) == Decimal("10")


def test_grn_over_receipt_blocked(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "OVR")
    warehouse_id = _create_warehouse(client, headers, "OVRWH")
    product_id = _create_product(client, headers, "OVR-SKU-1")

    po_data = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "5", "unit_cost": "10"}],
    )
    po_id = po_data["id"]
    po_line_id = po_data["lines"][0]["id"]
    _approve_po(client, headers, po_id)

    grn_resp = client.post(
        f"/purchase/grn/from-po/{po_id}",
        headers=headers,
        json={
            "lines": [
                {
                    "po_line_id": po_line_id,
                    "received_qty": "6",
                    "batch_no": "BATCH-OVR-1",
                    "expiry_date": "2030-12-31",
                }
            ]
        },
    )

    assert grn_resp.status_code == 400
    err = _error_payload(grn_resp)
    assert err["error_code"] == "OVER_RECEIPT"
    assert err["message"] == "Cannot receive more than remaining quantity"


def test_grn_double_post_protection(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "DBL")
    warehouse_id = _create_warehouse(client, headers, "DBLWH")
    product_id = _create_product(client, headers, "DBL-SKU-1")

    po_data = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "5", "unit_cost": "10"}],
    )
    po_id = po_data["id"]
    po_line_id = po_data["lines"][0]["id"]
    _approve_po(client, headers, po_id)

    grn_data = _create_grn(
        client,
        headers,
        po_id,
        lines=[
            {
                "po_line_id": po_line_id,
                "received_qty": "5",
                "batch_no": "BATCH-DBL-1",
                "expiry_date": "2030-12-31",
            }
        ],
    )
    grn_id = grn_data["id"]

    _post_grn(client, headers, grn_id)

    second_post = client.post(f"/purchase/grn/{grn_id}/post", headers=headers)
    assert second_post.status_code == 409
    err = _error_payload(second_post)
    assert err["error_code"] == "GRN_ALREADY_POSTED"

    summary = (
        db.query(StockSummary)
        .filter(StockSummary.warehouse_id == warehouse_id)
        .filter(StockSummary.product_id == product_id)
        .first()
    )
    assert summary is not None
    assert Decimal(str(summary.qty_on_hand)) == Decimal("5")


def test_multi_line_partial_then_close(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "MLP")
    warehouse_id = _create_warehouse(client, headers, "MLPWH")
    product_a = _create_product(client, headers, "MLP-SKU-A")
    product_b = _create_product(client, headers, "MLP-SKU-B")

    po_data = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[
            {"product_id": product_a, "ordered_qty": "10", "unit_cost": "10"},
            {"product_id": product_b, "ordered_qty": "8", "unit_cost": "20"},
        ],
    )
    po_id = po_data["id"]
    line_a = po_data["lines"][0]["id"]
    line_b = po_data["lines"][1]["id"]
    _approve_po(client, headers, po_id)

    grn1 = _create_grn(
        client,
        headers,
        po_id,
        lines=[
            {
                "po_line_id": line_a,
                "received_qty": "10",
                "batch_no": "MLP-BATCH-A",
                "expiry_date": "2030-12-31",
            }
        ],
    )
    _post_grn(client, headers, grn1["id"])

    po_after_grn1 = client.get(f"/purchase/po/{po_id}", headers=headers)
    assert po_after_grn1.status_code == 200
    assert po_after_grn1.json()["status"] == "PARTIALLY_RECEIVED"

    grn2 = _create_grn(
        client,
        headers,
        po_id,
        lines=[
            {
                "po_line_id": line_b,
                "received_qty": "8",
                "batch_no": "MLP-BATCH-B",
                "expiry_date": "2030-12-31",
            }
        ],
    )
    _post_grn(client, headers, grn2["id"])

    po_after_grn2 = client.get(f"/purchase/po/{po_id}", headers=headers)
    assert po_after_grn2.status_code == 200
    assert po_after_grn2.json()["status"] == "CLOSED"

    line_map = {line["id"]: line for line in po_after_grn2.json()["lines"]}
    assert Decimal(str(line_map[line_a]["received_qty"])) == Decimal("10")
    assert Decimal(str(line_map[line_b]["received_qty"])) == Decimal("8")


def test_multi_batch_same_product_accumulates_stock(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "MBT")
    warehouse_id = _create_warehouse(client, headers, "MBTWH")
    product_id = _create_product(client, headers, "MBT-SKU-1")

    po_data = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "10", "unit_cost": "11"}],
    )
    po_id = po_data["id"]
    po_line_id = po_data["lines"][0]["id"]
    _approve_po(client, headers, po_id)

    grn1 = _create_grn(
        client,
        headers,
        po_id,
        lines=[
            {
                "po_line_id": po_line_id,
                "received_qty": "5",
                "batch_no": "MBT-BATCH-A",
                "expiry_date": "2030-06-30",
            }
        ],
    )
    _post_grn(client, headers, grn1["id"])

    grn2 = _create_grn(
        client,
        headers,
        po_id,
        lines=[
            {
                "po_line_id": po_line_id,
                "received_qty": "5",
                "batch_no": "MBT-BATCH-B",
                "expiry_date": "2031-06-30",
            }
        ],
    )
    _post_grn(client, headers, grn2["id"])

    po_get = client.get(f"/purchase/po/{po_id}", headers=headers)
    assert po_get.status_code == 200
    assert po_get.json()["status"] == "CLOSED"

    summaries = (
        db.query(StockSummary)
        .filter(StockSummary.warehouse_id == warehouse_id)
        .filter(StockSummary.product_id == product_id)
        .all()
    )
    assert len(summaries) == 2
    total_qty = sum((Decimal(str(summary.qty_on_hand)) for summary in summaries), Decimal("0"))
    assert total_qty == Decimal("10")


def test_one_grn_can_have_multiple_products(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "MGP")
    warehouse_id = _create_warehouse(client, headers, "MGPWH")
    product_a = _create_product(client, headers, "MGP-SKU-A")
    product_b = _create_product(client, headers, "MGP-SKU-B")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[
            {"product_id": product_a, "ordered_qty": "4", "unit_cost": "11"},
            {"product_id": product_b, "ordered_qty": "7", "unit_cost": "13"},
        ],
    )
    _approve_po(client, headers, po["id"])

    grn_response = client.post(
        f"/purchase/grn/from-po/{po['id']}",
        headers=headers,
        json={
            "lines": [
                {
                    "po_line_id": po["lines"][0]["id"],
                    "received_qty": "4",
                    "batch_no": "MGP-BATCH-A",
                    "expiry_date": "2030-10-31",
                },
                {
                    "po_line_id": po["lines"][1]["id"],
                    "received_qty": "7",
                    "batch_no": "MGP-BATCH-B",
                    "expiry_date": "2031-10-31",
                },
            ]
        },
    )
    assert grn_response.status_code == 201, grn_response.text
    grn = grn_response.json()
    assert len(grn["lines"]) == 2

    posted = _post_grn(client, headers, grn["id"])
    assert posted["total_products"] == 2
    assert Decimal(str(posted["total_received_qty"])) == Decimal("11")

    summaries = (
        db.query(StockSummary)
        .filter(StockSummary.warehouse_id == warehouse_id)
        .all()
    )
    assert len(summaries) == 2
    assert sum((Decimal(str(summary.qty_on_hand)) for summary in summaries), Decimal("0")) == Decimal("11")


def test_one_grn_line_can_have_multiple_batch_rows(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "MBR")
    warehouse_id = _create_warehouse(client, headers, "MBRWH")
    product_id = _create_product(client, headers, "MBR-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "10", "unit_cost": "15"}],
    )
    _approve_po(client, headers, po["id"])

    grn_response = client.post(
        f"/purchase/grn/from-po/{po['id']}",
        headers=headers,
        json={
            "remarks": "Split receipt across two manufacturer lots",
            "lines": [
                {
                    "po_line_id": po["lines"][0]["id"],
                    "received_qty": "10",
                    "batch_lines": [
                        {
                            "batch_no": "MBR-BATCH-1",
                            "expiry_date": "2030-06-30",
                            "received_qty": "4",
                            "free_qty": "1",
                            "mrp": "25.00",
                        },
                        {
                            "batch_no": "MBR-BATCH-2",
                            "expiry_date": "2031-01-31",
                            "received_qty": "6",
                            "free_qty": "0",
                            "mrp": "25.00",
                        },
                    ],
                }
            ],
        },
    )
    assert grn_response.status_code == 201, grn_response.text
    draft = grn_response.json()
    assert Decimal(str(draft["lines"][0]["received_qty_total"])) == Decimal("10")
    assert Decimal(str(draft["lines"][0]["free_qty_total"])) == Decimal("1")
    assert len(draft["lines"][0]["batch_lines"]) == 2

    posted = _post_grn(client, headers, draft["id"])
    assert posted["lines"][0]["product_name_snapshot"] == f"Product MBR-SKU-1"
    assert [batch["batch_no"] for batch in posted["lines"][0]["batch_lines"]] == [
        "MBR-BATCH-1",
        "MBR-BATCH-2",
    ]

    ledger_rows = (
        db.query(InventoryLedger)
        .filter(InventoryLedger.reason == InventoryReason.PURCHASE_GRN)
        .filter(InventoryLedger.ref_id == posted["grn_number"])
        .order_by(InventoryLedger.id.asc())
        .all()
    )
    assert len(ledger_rows) == 2
    assert [Decimal(str(row.qty)) for row in ledger_rows] == [Decimal("5"), Decimal("6")]

    summaries = (
        db.query(StockSummary)
        .filter(StockSummary.warehouse_id == warehouse_id)
        .filter(StockSummary.product_id == product_id)
        .order_by(StockSummary.batch_id.asc())
        .all()
    )
    assert len(summaries) == 2
    assert [Decimal(str(summary.qty_on_hand)) for summary in summaries] == [Decimal("5"), Decimal("6")]


def test_grn_from_po_works_without_bill_and_bill_can_be_attached_later(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}
    created_by = db.query(User).first()
    assert created_by is not None

    supplier_id = _create_supplier(client, headers, "ATL")
    warehouse_id = _create_warehouse(client, headers, "ATLWH")
    product_id = _create_product(client, headers, "ATL-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "5", "unit_cost": "10"}],
    )
    _approve_po(client, headers, po["id"])

    grn = _create_grn(
        client,
        headers,
        po["id"],
        lines=[
            {
                "po_line_id": po["lines"][0]["id"],
                "received_qty": "5",
                "batch_no": "ATL-BATCH-1",
                "expiry_date": "2030-12-31",
            }
        ],
    )
    posted = _post_grn(client, headers, grn["id"])
    assert posted["purchase_bill_id"] is None

    purchase_bill = _seed_purchase_bill(
        db,
        created_by=created_by.id,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        purchase_order_id=po["id"],
        product_id=product_id,
        qty="5",
        bill_number="PB-ATL-001",
        supplier_gstin=_valid_test_gstin("ATL"),
    )

    attach_response = client.post(
        f"/purchase/grn/{posted['id']}/attach-bill",
        headers=headers,
        json={"purchase_bill_id": purchase_bill.id},
    )
    assert attach_response.status_code == 200, attach_response.text
    attached = attach_response.json()
    assert attached["purchase_bill_id"] == purchase_bill.id
    assert attached["purchase_bill_number"] == purchase_bill.bill_number


def test_grn_can_be_created_from_bill(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}
    created_by = db.query(User).first()
    assert created_by is not None

    supplier_id = _create_supplier(client, headers, "BIL")
    warehouse_id = _create_warehouse(client, headers, "BILWH")
    product_id = _create_product(client, headers, "BIL-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "5", "unit_cost": "10"}],
    )
    _approve_po(client, headers, po["id"])

    purchase_bill = _seed_purchase_bill(
        db,
        created_by=created_by.id,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        purchase_order_id=po["id"],
        product_id=product_id,
        qty="5",
        bill_number="PB-BIL-001",
        supplier_gstin=_valid_test_gstin("BIL"),
    )

    response = client.post(
        f"/purchase/grn/from-bill/{purchase_bill.id}",
        headers=headers,
        json={
            "lines": [
                {
                    "po_line_id": po["lines"][0]["id"],
                    "purchase_bill_line_id": purchase_bill.lines[0].id,
                    "received_qty": "5",
                    "batch_no": "BIL-BATCH-1",
                    "expiry_date": "2030-11-30",
                }
            ]
        },
    )
    assert response.status_code == 201, response.text
    grn = response.json()
    assert grn["purchase_bill_id"] == purchase_bill.id
    assert grn["purchase_bill_number"] == purchase_bill.bill_number
    assert grn["lines"][0]["billed_qty_snapshot"] == "5.000"


def test_attach_bill_validates_supplier_and_po_mismatch(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}
    created_by = db.query(User).first()
    assert created_by is not None

    supplier_id = _create_supplier(client, headers, "MAT")
    other_supplier_id = _create_supplier(client, headers, "MBM")
    warehouse_id = _create_warehouse(client, headers, "MATWH")
    product_id = _create_product(client, headers, "MAT-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "5", "unit_cost": "10"}],
    )
    _approve_po(client, headers, po["id"])
    grn = _create_grn(
        client,
        headers,
        po["id"],
        lines=[
            {
                "po_line_id": po["lines"][0]["id"],
                "received_qty": "2",
                "batch_no": "MAT-BATCH-1",
                "expiry_date": "2030-10-31",
            }
        ],
    )

    supplier_mismatch_bill = _seed_purchase_bill(
        db,
        created_by=created_by.id,
        supplier_id=other_supplier_id,
        warehouse_id=warehouse_id,
        purchase_order_id=po["id"],
        product_id=product_id,
        qty="2",
        bill_number="PB-MAT-001",
    )
    supplier_mismatch_response = client.post(
        f"/purchase/grn/{grn['id']}/attach-bill",
        headers=headers,
        json={"purchase_bill_id": supplier_mismatch_bill.id},
    )
    assert supplier_mismatch_response.status_code == 400
    assert _error_payload(supplier_mismatch_response)["error_code"] == "SUPPLIER_MISMATCH"

    other_po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "5", "unit_cost": "10"}],
    )
    _approve_po(client, headers, other_po["id"])
    po_mismatch_bill = _seed_purchase_bill(
        db,
        created_by=created_by.id,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        purchase_order_id=other_po["id"],
        product_id=product_id,
        qty="2",
        bill_number="PB-MAT-002",
    )
    po_mismatch_response = client.post(
        f"/purchase/grn/{grn['id']}/attach-bill",
        headers=headers,
        json={"purchase_bill_id": po_mismatch_bill.id},
    )
    assert po_mismatch_response.status_code == 400
    assert _error_payload(po_mismatch_response)["error_code"] == "PO_MISMATCH"


def test_grn_detail_payload_exposes_product_names_and_batch_numbers(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "DET")
    warehouse_id = _create_warehouse(client, headers, "DETWH")
    product_id = _create_product(client, headers, "DET-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "3", "unit_cost": "14"}],
    )
    _approve_po(client, headers, po["id"])
    grn = _create_grn(
        client,
        headers,
        po["id"],
        lines=[
            {
                "po_line_id": po["lines"][0]["id"],
                "received_qty": "3",
                "batch_no": "DET-BATCH-1",
                "expiry_date": "2030-12-31",
            }
        ],
    )
    _post_grn(client, headers, grn["id"])

    detail_response = client.get(f"/purchase/grn/{grn['id']}", headers=headers)
    assert detail_response.status_code == 200, detail_response.text
    detail = detail_response.json()
    assert detail["supplier_name"] == "Supplier DET"
    assert detail["warehouse_name"] == "Warehouse DETWH"
    assert detail["po_number"].startswith("PO-")
    assert detail["lines"][0]["product_name"] == "Product DET-SKU-1"
    assert detail["lines"][0]["product_name_snapshot"] == "Product DET-SKU-1"
    assert detail["lines"][0]["batch_lines"][0]["batch_no"] == "DET-BATCH-1"


def test_grn_creation_fails_on_warehouse_mismatch(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "WMM")
    warehouse_id = _create_warehouse(client, headers, "WMMWH1")
    other_warehouse_id = _create_warehouse(client, headers, "WMMWH2")
    product_id = _create_product(client, headers, "WMM-SKU-1")

    po_data = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "5", "unit_cost": "10"}],
    )
    po_id = po_data["id"]
    po_line_id = po_data["lines"][0]["id"]
    _approve_po(client, headers, po_id)

    grn_resp = client.post(
        f"/purchase/grn/from-po/{po_id}",
        headers=headers,
        json={
            "warehouse_id": other_warehouse_id,
            "lines": [
                {
                    "po_line_id": po_line_id,
                    "received_qty": "5",
                    "batch_no": "WMM-BATCH-1",
                    "expiry_date": "2030-12-31",
                }
            ],
        },
    )
    assert grn_resp.status_code == 400
    err = _error_payload(grn_resp)
    assert err["error_code"] == "WAREHOUSE_MISMATCH"


def test_grn_post_idempotency_keeps_stock_unchanged(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "IDM")
    warehouse_id = _create_warehouse(client, headers, "IDMWH")
    product_id = _create_product(client, headers, "IDM-SKU-1")

    po_data = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "5", "unit_cost": "10"}],
    )
    po_id = po_data["id"]
    po_line_id = po_data["lines"][0]["id"]
    _approve_po(client, headers, po_id)

    grn_data = _create_grn(
        client,
        headers,
        po_id,
        lines=[
            {
                "po_line_id": po_line_id,
                "received_qty": "5",
                "batch_no": "IDM-BATCH-1",
                "expiry_date": "2030-12-31",
            }
        ],
    )
    grn_id = grn_data["id"]

    _post_grn(client, headers, grn_id)
    second_post = client.post(f"/purchase/grn/{grn_id}/post", headers=headers)
    assert second_post.status_code == 409
    err = _error_payload(second_post)
    assert err["error_code"] == "GRN_ALREADY_POSTED"

    qty_on_hand = (
        db.query(func.coalesce(func.sum(StockSummary.qty_on_hand), 0))
        .filter(StockSummary.warehouse_id == warehouse_id)
        .filter(StockSummary.product_id == product_id)
        .scalar()
    )
    assert Decimal(str(qty_on_hand)) == Decimal("5")


def test_po_approve_invalid_state_returns_409(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "APR")
    warehouse_id = _create_warehouse(client, headers, "APRWH")
    product_id = _create_product(client, headers, "APR-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "3", "unit_cost": "10"}],
    )
    po_id = po["id"]
    _approve_po(client, headers, po_id)

    second_approve = client.post(f"/purchase/po/{po_id}/approve", headers=headers)
    assert second_approve.status_code == 409
    err = _error_payload(second_approve)
    assert err["error_code"] == "INVALID_STATE"


def test_grn_requires_po_to_be_approved(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "NAPP")
    warehouse_id = _create_warehouse(client, headers, "NAPPWH")
    product_id = _create_product(client, headers, "NAPP-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "3", "unit_cost": "10"}],
    )

    grn_resp = client.post(
        f"/purchase/grn/from-po/{po['id']}",
        headers=headers,
        json={
            "lines": [
                {
                    "po_line_id": po["lines"][0]["id"],
                    "received_qty": "1",
                    "batch_no": "NAPP-BATCH-1",
                    "expiry_date": "2030-12-31",
                }
            ]
        },
    )
    assert grn_resp.status_code == 409
    err = _error_payload(grn_resp)
    assert err["error_code"] == "PO_NOT_APPROVED"


def test_grn_requires_batch_details(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "BCH")
    warehouse_id = _create_warehouse(client, headers, "BCHWH")
    product_id = _create_product(client, headers, "BCH-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "3", "unit_cost": "10"}],
    )
    _approve_po(client, headers, po["id"])

    missing_batch = client.post(
        f"/purchase/grn/from-po/{po['id']}",
        headers=headers,
        json={
            "lines": [
                {
                    "po_line_id": po["lines"][0]["id"],
                    "received_qty": "1",
                }
            ]
        },
    )
    assert missing_batch.status_code == 400
    err = _error_payload(missing_batch)
    assert err["error_code"] == "BATCH_REQUIRED"


def test_grn_requires_expiry_with_batch_no(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "EXP")
    warehouse_id = _create_warehouse(client, headers, "EXPWH")
    product_id = _create_product(client, headers, "EXP-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "3", "unit_cost": "10"}],
    )
    _approve_po(client, headers, po["id"])

    missing_expiry = client.post(
        f"/purchase/grn/from-po/{po['id']}",
        headers=headers,
        json={
            "lines": [
                {
                    "po_line_id": po["lines"][0]["id"],
                    "received_qty": "1",
                    "batch_no": "EXP-BATCH-1",
                }
            ]
        },
    )
    assert missing_expiry.status_code == 400
    err = _error_payload(missing_expiry)
    assert err["error_code"] == "BATCH_REQUIRED"


def test_grn_supplier_mismatch_returns_400(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "SUP1")
    other_supplier_id = _create_supplier(client, headers, "SUP2")
    warehouse_id = _create_warehouse(client, headers, "SUPWH")
    product_id = _create_product(client, headers, "SUP-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "3", "unit_cost": "10"}],
    )
    _approve_po(client, headers, po["id"])

    mismatch = client.post(
        f"/purchase/grn/from-po/{po['id']}",
        headers=headers,
        json={
            "supplier_id": other_supplier_id,
            "lines": [
                {
                    "po_line_id": po["lines"][0]["id"],
                    "received_qty": "1",
                    "batch_no": "SUP-BATCH-1",
                    "expiry_date": "2030-12-31",
                }
            ],
        },
    )
    assert mismatch.status_code == 400
    err = _error_payload(mismatch)
    assert err["error_code"] == "SUPPLIER_MISMATCH"


def test_closed_po_cannot_receive_more_grn(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "CLS")
    warehouse_id = _create_warehouse(client, headers, "CLSWH")
    product_id = _create_product(client, headers, "CLS-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "2", "unit_cost": "10"}],
    )
    _approve_po(client, headers, po["id"])

    grn = _create_grn(
        client,
        headers,
        po["id"],
        lines=[
            {
                "po_line_id": po["lines"][0]["id"],
                "received_qty": "2",
                "batch_no": "CLS-BATCH-1",
                "expiry_date": "2030-12-31",
            }
        ],
    )
    _post_grn(client, headers, grn["id"])

    closed_po_attempt = client.post(
        f"/purchase/grn/from-po/{po['id']}",
        headers=headers,
        json={
            "lines": [
                {
                    "po_line_id": po["lines"][0]["id"],
                    "received_qty": "1",
                    "batch_no": "CLS-BATCH-2",
                    "expiry_date": "2030-12-31",
                }
            ]
        },
    )
    assert closed_po_attempt.status_code == 409
    err = _error_payload(closed_po_attempt)
    assert err["error_code"] == "INVALID_STATE"


def test_audit_logs_created_for_po_approve_and_grn_post(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "ADT")
    warehouse_id = _create_warehouse(client, headers, "ADTWH")
    product_id = _create_product(client, headers, "ADT-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        lines=[{"product_id": product_id, "ordered_qty": "5", "unit_cost": "10"}],
    )
    _approve_po(client, headers, po["id"])

    grn = _create_grn(
        client,
        headers,
        po["id"],
        lines=[
            {
                "po_line_id": po["lines"][0]["id"],
                "received_qty": "5",
                "batch_no": "ADT-BATCH-1",
                "expiry_date": "2030-12-31",
            }
        ],
    )
    _post_grn(client, headers, grn["id"])

    po_approve_log = (
        db.query(AuditLog)
        .filter(AuditLog.entity_type == "PO")
        .filter(AuditLog.entity_id == po["id"])
        .filter(AuditLog.action == "APPROVE")
        .first()
    )
    assert po_approve_log is not None

    grn_post_log = (
        db.query(AuditLog)
        .filter(AuditLog.entity_type == "GRN")
        .filter(AuditLog.entity_id == grn["id"])
        .filter(AuditLog.action == "POST")
        .first()
    )
    assert grn_post_log is not None
