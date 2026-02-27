from collections.abc import Generator
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.base import Base
from app.models.enums import InventoryReason, PartyType
from app.models.inventory import InventoryLedger, StockSummary
from app.models.role import Role
from app.models.user import User


def _error_payload(response) -> dict[str, str]:
    detail = response.json().get("detail")
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
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token(str(user.id))


def _create_supplier(client: TestClient, headers: dict[str, str], code_suffix: str = "01") -> int:
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "name": f"Supplier {code_suffix}",
            "party_type": PartyType.DISTRIBUTOR.value,
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


@pytest.fixture()
def client_with_test_db() -> Generator[tuple[TestClient, Session], None, None]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    session = testing_session_local()

    def _override_get_db() -> Generator[Session, None, None]:
        yield session

    app.dependency_overrides[get_db] = _override_get_db
    client = TestClient(app)
    try:
        yield client, session
    finally:
        app.dependency_overrides.clear()
        client.close()
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


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
    batch_id = grn_data["lines"][0]["batch_id"]

    posted = _post_grn(client, headers, grn_id)
    assert posted["status"] == "POSTED"

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
