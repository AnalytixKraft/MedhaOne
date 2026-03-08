from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.enums import InventoryReason, PartyType
from app.models.role import Role
from app.models.user import User


def _create_access_user(db: Session) -> str:
    role = Role(name="admin", is_active=True)
    db.add(role)
    db.flush()

    user = User(
        email="reports-admin@medhaone.app",
        full_name="Reports Admin",
        hashed_password="not-used",
        is_active=True,
        is_superuser=True,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token(str(user.id))


def _create_supplier(client: TestClient, headers: dict[str, str], name: str) -> int:
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "name": name,
            "party_type": PartyType.SUPER_STOCKIST.value,
            "phone": "9999999999",
            "is_active": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_warehouse(client: TestClient, headers: dict[str, str], code: str) -> int:
    response = client.post(
        "/masters/warehouses",
        headers=headers,
        json={"name": f"Warehouse {code}", "code": code, "is_active": True},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_product(client: TestClient, headers: dict[str, str], sku: str) -> int:
    response = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": sku,
            "name": f"Product {sku}",
            "brand": "AK",
            "hsn": "3004",
            "uom": "BOX",
            "is_active": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_po(
    client: TestClient,
    headers: dict[str, str],
    *,
    supplier_id: int,
    warehouse_id: int,
    order_date: str,
    ordered_qty: str,
    unit_cost: str,
    product_id: int,
) -> dict:
    response = client.post(
        "/purchase/po",
        headers=headers,
        json={
            "supplier_id": supplier_id,
            "warehouse_id": warehouse_id,
            "order_date": order_date,
            "lines": [
                {
                    "product_id": product_id,
                    "ordered_qty": ordered_qty,
                    "unit_cost": unit_cost,
                    "free_qty": "0",
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _create_and_post_grn(
    client: TestClient,
    headers: dict[str, str],
    *,
    po_id: int,
    po_line_id: int,
    received_qty: str,
    free_qty: str,
    batch_no: str,
    expiry_date: str,
    received_date: str,
) -> dict:
    create_response = client.post(
        f"/purchase/grn/from-po/{po_id}",
        headers=headers,
        json={
            "received_date": received_date,
            "lines": [
                {
                    "po_line_id": po_line_id,
                    "received_qty": received_qty,
                    "free_qty": free_qty,
                    "batch_no": batch_no,
                    "expiry_date": expiry_date,
                }
            ],
        },
    )
    assert create_response.status_code == 201, create_response.text
    grn = create_response.json()

    post_response = client.post(f"/purchase/grn/{grn['id']}/post", headers=headers)
    assert post_response.status_code == 200, post_response.text
    return post_response.json()


def _post_opening_stock(
    client: TestClient,
    headers: dict[str, str],
    *,
    warehouse_id: int,
    product_id: int,
    batch_id: int,
    qty: str,
) -> dict:
    response = client.post(
        "/inventory/in",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch_id,
            "qty": qty,
            "reason": InventoryReason.OPENING_STOCK.value,
            "ref_type": "OPENING",
            "ref_id": "OPENING-1",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _post_legacy_opening_stock(
    client: TestClient,
    headers: dict[str, str],
    *,
    warehouse_id: int,
    product_id: int,
    batch_id: int,
    qty: str,
) -> dict:
    response = client.post(
        "/inventory/in",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch_id,
            "qty": qty,
            "reason": InventoryReason.STOCK_ADJUSTMENT.value,
            "ref_type": "OPENING",
            "ref_id": "LEGACY-OPENING-1",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _seed_report_dataset(client: TestClient, db: Session) -> dict[str, object]:
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    supplier_id = _create_supplier(client, headers, "Report Supplier")
    warehouse_id = _create_warehouse(client, headers, "RPTWH")
    product_id = _create_product(client, headers, "RPT-SKU-1")

    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        order_date="2026-02-20",
        ordered_qty="10",
        unit_cost="15.50",
        product_id=product_id,
    )

    approve = client.post(f"/purchase/po/{po['id']}/approve", headers=headers)
    assert approve.status_code == 200, approve.text

    grn = _create_and_post_grn(
        client,
        headers,
        po_id=po["id"],
        po_line_id=po["lines"][0]["id"],
        received_qty="8",
        free_qty="2",
        batch_no="RPT-BATCH-1",
        expiry_date="2031-12-31",
        received_date="2026-02-21",
    )

    adjust = client.post(
        "/inventory/adjust",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": grn["lines"][0]["batch_id"],
            "delta_qty": "-3",
            "reason": InventoryReason.STOCK_ADJUSTMENT.value,
        },
    )
    assert adjust.status_code == 200, adjust.text

    second_po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        order_date="2026-02-22",
        ordered_qty="4",
        unit_cost="9.00",
        product_id=product_id,
    )

    return {
        "headers": headers,
        "supplier_id": supplier_id,
        "warehouse_id": warehouse_id,
        "product_id": product_id,
        "po": po,
        "grn": grn,
        "second_po": second_po,
    }


def test_stock_inward_report_returns_expected_row(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_report_dataset(client, db)

    response = client.get(
        "/reports/stock-inward",
        headers=seeded["headers"],
        params={"supplier_id": seeded["supplier_id"]},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    row = payload["data"][0]
    assert row["grn_number"] == seeded["grn"]["grn_number"]
    assert row["po_number"] == seeded["po"]["po_number"]
    assert Decimal(str(row["qty_received"])) == Decimal("8")
    assert Decimal(str(row["free_qty"])) == Decimal("2")


def test_purchase_register_totals_are_correct(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_report_dataset(client, db)

    response = client.get(
        "/reports/purchase-register",
        headers=seeded["headers"],
        params={"supplier_name": "Report Supplier"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 2

    first_row = next(
        item for item in payload["data"] if item["po_number"] == seeded["po"]["po_number"]
    )
    assert first_row["status"] == "PARTIALLY_RECEIVED"
    assert Decimal(str(first_row["total_order_qty"])) == Decimal("10")
    assert Decimal(str(first_row["total_received_qty"])) == Decimal("8")
    assert Decimal(str(first_row["pending_qty"])) == Decimal("2")
    assert Decimal(str(first_row["total_value"])) == Decimal("155.0000")


def test_stock_movement_report_reflects_ledger_entries(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_report_dataset(client, db)

    response = client.get(
        "/reports/stock-movement",
        headers=seeded["headers"],
        params={
            "product_id": seeded["product_id"],
            "warehouse_id": seeded["warehouse_id"],
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 2

    inward_row, outward_row = payload["data"]
    assert inward_row["reason"] == "PURCHASE_GRN"
    assert Decimal(str(inward_row["qty_in"])) == Decimal("10")
    assert Decimal(str(inward_row["qty_out"])) == Decimal("0")
    assert Decimal(str(inward_row["running_balance"])) == Decimal("10")

    assert outward_row["reason"] == "STOCK_ADJUSTMENT"
    assert Decimal(str(outward_row["qty_in"])) == Decimal("0")
    assert Decimal(str(outward_row["qty_out"])) == Decimal("3")
    assert Decimal(str(outward_row["running_balance"])) == Decimal("7")


def test_report_date_filters_work(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_report_dataset(client, db)

    stock_inward_response = client.get(
        "/reports/stock-inward",
        headers=seeded["headers"],
        params={"date_from": "2026-02-22"},
    )
    assert stock_inward_response.status_code == 200, stock_inward_response.text
    assert stock_inward_response.json()["total"] == 0

    purchase_register_response = client.get(
        "/reports/purchase-register",
        headers=seeded["headers"],
        params={"date_from": "2026-02-22", "date_to": "2026-02-22"},
    )
    assert purchase_register_response.status_code == 200, purchase_register_response.text
    payload = purchase_register_response.json()
    assert payload["total"] == 1
    assert payload["data"][0]["po_number"] == seeded["second_po"]["po_number"]


def test_report_pagination_works(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_report_dataset(client, db)

    response = client.get(
        "/reports/purchase-register",
        headers=seeded["headers"],
        params={"page": 2, "page_size": 1},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 2
    assert payload["page"] == 2
    assert payload["page_size"] == 1
    assert len(payload["data"]) == 1
    assert payload["data"][0]["po_number"] == seeded["po"]["po_number"]


def test_current_stock_report_returns_summary_and_supports_filters(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_report_dataset(client, db)

    response = client.get(
        "/reports/current-stock",
        headers=seeded["headers"],
        params={
            "brand_values": "AK",
            "warehouse_ids": str(seeded["warehouse_id"]),
            "stock_status": "available",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["total"] == 1
    assert payload["summary"]["total_skus"] == 1
    assert Decimal(str(payload["summary"]["total_stock_qty"])) == Decimal("7")

    row = payload["data"][0]
    assert row["sku"] == "RPT-SKU-1"
    assert row["brand"] == "AK"
    assert Decimal(str(row["available_qty"])) == Decimal("7")
    assert Decimal(str(row["reserved_qty"])) == Decimal("0")

    mismatch_response = client.get(
        "/reports/current-stock",
        headers=seeded["headers"],
        params={"brand_values": "OTHER"},
    )
    assert mismatch_response.status_code == 200, mismatch_response.text
    mismatch_payload = mismatch_response.json()
    assert mismatch_payload["total"] == 0
    assert mismatch_payload["data"] == []


def test_report_filter_options_endpoint_returns_master_lists(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_report_dataset(client, db)

    response = client.get("/reports/filter-options", headers=seeded["headers"])
    assert response.status_code == 200, response.text
    payload = response.json()

    assert "AK" in payload["brands"]
    assert "3004" in payload["categories"]
    assert "RPT-BATCH-1" in payload["batches"]
    assert any(option["id"] == seeded["product_id"] for option in payload["products"])
    assert any(option["id"] == seeded["supplier_id"] for option in payload["suppliers"])
    assert any(option["id"] == seeded["warehouse_id"] for option in payload["warehouses"])


def test_current_stock_report_can_filter_opening_vs_non_opening(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_report_dataset(client, db)
    _post_opening_stock(
        client,
        seeded["headers"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        batch_id=seeded["grn"]["lines"][0]["batch_id"],
        qty="5",
    )

    opening_response = client.get(
        "/reports/current-stock",
        headers=seeded["headers"],
        params={"stock_source": "opening"},
    )
    assert opening_response.status_code == 200, opening_response.text
    opening_payload = opening_response.json()
    assert opening_payload["total"] == 1
    assert Decimal(str(opening_payload["data"][0]["available_qty"])) == Decimal("5")

    non_opening_response = client.get(
        "/reports/current-stock",
        headers=seeded["headers"],
        params={"stock_source": "non_opening"},
    )
    assert non_opening_response.status_code == 200, non_opening_response.text
    non_opening_payload = non_opening_response.json()
    assert non_opening_payload["total"] == 1
    assert Decimal(str(non_opening_payload["data"][0]["available_qty"])) == Decimal("7")


def test_opening_stock_report_returns_rows_and_summary(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_report_dataset(client, db)
    _post_opening_stock(
        client,
        seeded["headers"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        batch_id=seeded["grn"]["lines"][0]["batch_id"],
        qty="5",
    )

    response = client.get("/reports/opening-stock", headers=seeded["headers"])
    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["total"] == 1
    assert payload["summary"]["total_skus"] == 1
    assert Decimal(str(payload["summary"]["total_opening_qty"])) == Decimal("5")
    assert Decimal(str(payload["summary"]["total_opening_value"])) == Decimal("0")
    assert Decimal(str(payload["data"][0]["opening_qty"])) == Decimal("5")
    assert Decimal(str(payload["data"][0]["current_qty"])) == Decimal("12")


def test_opening_stock_report_includes_legacy_opening_entries(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_report_dataset(client, db)
    _post_legacy_opening_stock(
        client,
        seeded["headers"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        batch_id=seeded["grn"]["lines"][0]["batch_id"],
        qty="4",
    )

    response = client.get("/reports/opening-stock", headers=seeded["headers"])
    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["total"] == 1
    assert Decimal(str(payload["summary"]["total_opening_qty"])) == Decimal("4")
    assert Decimal(str(payload["data"][0]["opening_qty"])) == Decimal("4")

    opening_response = client.get(
        "/reports/current-stock",
        headers=seeded["headers"],
        params={"stock_source": "opening"},
    )
    assert opening_response.status_code == 200, opening_response.text
    opening_payload = opening_response.json()
    assert opening_payload["total"] == 1
    assert Decimal(str(opening_payload["data"][0]["available_qty"])) == Decimal("4")

    non_opening_response = client.get(
        "/reports/current-stock",
        headers=seeded["headers"],
        params={"stock_source": "non_opening"},
    )
    assert non_opening_response.status_code == 200, non_opening_response.text
    non_opening_payload = non_opening_response.json()
    assert non_opening_payload["total"] == 1
    assert Decimal(str(non_opening_payload["data"][0]["available_qty"])) == Decimal("7")
