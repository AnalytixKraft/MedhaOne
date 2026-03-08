from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.enums import DispatchNoteStatus, InventoryReason, SalesOrderStatus, StockReservationStatus
from app.models.inventory import InventoryLedger, StockSummary
from app.models.sales import SalesOrder, StockReservation
from app.testing import (
    approve_po,
    create_and_post_grn,
    create_po,
    create_product,
    create_restricted_headers,
    create_superuser_headers,
    create_supplier,
    create_warehouse,
)


def _create_customer(client: TestClient, headers: dict[str, str], name: str) -> int:
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "name": name,
            "party_type": "DISTRIBUTOR",
            "phone": "9999999999",
            "is_active": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _seed_stock(
    client: TestClient,
    db: Session,
    *,
    email: str,
    batches: list[tuple[str, str, str]],
) -> dict[str, object]:
    headers, user = create_superuser_headers(db, email)
    supplier_id = create_supplier(client, headers, f"Supplier {email}")
    customer_id = _create_customer(client, headers, f"Customer {email}")
    warehouse_id = create_warehouse(client, headers, f"WH{user.id}")
    product_id = create_product(client, headers, f"SKU-{user.id}")

    created_batches: list[dict[str, object]] = []
    for index, (qty, batch_no, expiry_date) in enumerate(batches, start=1):
        po = create_po(
            client,
            headers,
            supplier_id=supplier_id,
            warehouse_id=warehouse_id,
            product_id=product_id,
            ordered_qty=qty,
            unit_cost="10.00",
            order_date=date.today().isoformat(),
        )
        approve_po(client, headers, po["id"])
        grn = create_and_post_grn(
            client,
            headers,
            po_id=po["id"],
            po_line_id=po["lines"][0]["id"],
            received_qty=qty,
            batch_no=batch_no,
            expiry_date=expiry_date,
            received_date=date.today().isoformat(),
        )
        created_batches.append(
            {
                "batch_id": grn["lines"][0]["batch_id"],
                "batch_no": batch_no,
                "expiry_date": expiry_date,
                "qty": qty,
                "index": index,
            }
        )

    return {
        "headers": headers,
        "user_id": user.id,
        "customer_id": customer_id,
        "warehouse_id": warehouse_id,
        "product_id": product_id,
        "batches": created_batches,
    }


def _create_sales_order(
    client: TestClient,
    headers: dict[str, str],
    *,
    customer_id: int,
    warehouse_id: int,
    product_id: int,
    ordered_qty: str,
    unit_price: str = "25.00",
) -> dict:
    response = client.post(
        "/sales-orders",
        headers=headers,
        json={
            "customer_id": customer_id,
            "warehouse_id": warehouse_id,
            "order_date": date.today().isoformat(),
            "lines": [
                {
                    "product_id": product_id,
                    "ordered_qty": ordered_qty,
                    "unit_price": unit_price,
                    "discount_percent": "0",
                    "gst_rate": "12",
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _confirm_sales_order(client: TestClient, headers: dict[str, str], sales_order_id: int) -> dict:
    response = client.post(f"/sales-orders/{sales_order_id}/confirm", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _create_dispatch(
    client: TestClient,
    headers: dict[str, str],
    *,
    sales_order_id: int,
    sales_order_line_id: int,
    batch_id: int,
    dispatched_qty: str,
) -> dict:
    response = client.post(
        f"/dispatch-notes/from-sales-order/{sales_order_id}",
        headers=headers,
        json={
            "dispatch_date": date.today().isoformat(),
            "lines": [
                {
                    "sales_order_line_id": sales_order_line_id,
                    "batch_id": batch_id,
                    "dispatched_qty": dispatched_qty,
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_create_sales_order_draft(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(
        client,
        db,
        email="sales-draft@medhaone.app",
        batches=[("10", "SO-DRAFT-BATCH", "2030-12-31")],
    )

    payload = _create_sales_order(
        client,
        seeded["headers"],
        customer_id=seeded["customer_id"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        ordered_qty="4",
    )

    assert payload["status"] == SalesOrderStatus.DRAFT.value
    assert Decimal(str(payload["subtotal"])) == Decimal("100.00")
    assert Decimal(str(payload["total"])) == Decimal("100.00")
    assert Decimal(str(payload["lines"][0]["reserved_qty"])) == Decimal("0")
    assert Decimal(str(payload["lines"][0]["dispatched_qty"])) == Decimal("0")
    assert db.query(StockReservation).count() == 0


def test_confirm_sales_order_creates_reservations_and_audit(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(
        client,
        db,
        email="sales-confirm@medhaone.app",
        batches=[("10", "SO-CONFIRM-BATCH", "2030-12-31")],
    )
    order = _create_sales_order(
        client,
        seeded["headers"],
        customer_id=seeded["customer_id"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        ordered_qty="6",
    )

    confirmed = _confirm_sales_order(client, seeded["headers"], order["id"])

    assert confirmed["status"] == SalesOrderStatus.CONFIRMED.value
    assert Decimal(str(confirmed["lines"][0]["reserved_qty"])) == Decimal("6")

    reservation = db.query(StockReservation).filter(StockReservation.sales_order_id == order["id"]).one()
    assert Decimal(str(reservation.reserved_qty)) == Decimal("6")
    assert reservation.status == StockReservationStatus.ACTIVE
    assert (
        db.query(InventoryLedger)
        .filter(InventoryLedger.reason == InventoryReason.SALES_DISPATCH)
        .count()
        == 0
    )

    reservation_audit = (
        db.query(AuditLog)
        .filter(AuditLog.entity_type == "STOCK_RESERVATION", AuditLog.entity_id == reservation.id)
        .one()
    )
    assert reservation_audit.module == "Sales"
    assert reservation_audit.action == "CREATE"


def test_available_qty_decreases_after_reservation(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(
        client,
        db,
        email="sales-availability@medhaone.app",
        batches=[("10", "SO-AVAIL-BATCH", "2030-12-31")],
    )
    order = _create_sales_order(
        client,
        seeded["headers"],
        customer_id=seeded["customer_id"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        ordered_qty="6",
    )

    before = client.get(
        "/reservations/availability",
        headers=seeded["headers"],
        params={"warehouse_id": seeded["warehouse_id"], "product_id": seeded["product_id"]},
    )
    assert before.status_code == 200, before.text
    assert Decimal(str(before.json()["on_hand_qty"])) == Decimal("10")
    assert Decimal(str(before.json()["reserved_qty"])) == Decimal("0")
    assert Decimal(str(before.json()["available_qty"])) == Decimal("10")

    _confirm_sales_order(client, seeded["headers"], order["id"])

    after = client.get(
        "/reservations/availability",
        headers=seeded["headers"],
        params={"warehouse_id": seeded["warehouse_id"], "product_id": seeded["product_id"]},
    )
    assert after.status_code == 200, after.text
    assert Decimal(str(after.json()["on_hand_qty"])) == Decimal("10")
    assert Decimal(str(after.json()["reserved_qty"])) == Decimal("6")
    assert Decimal(str(after.json()["available_qty"])) == Decimal("4")


def test_second_sales_order_cannot_over_commit_reserved_stock(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(
        client,
        db,
        email="sales-overcommit@medhaone.app",
        batches=[("10", "SO-OVER-BATCH", "2030-12-31")],
    )
    first_order = _create_sales_order(
        client,
        seeded["headers"],
        customer_id=seeded["customer_id"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        ordered_qty="6",
    )
    _confirm_sales_order(client, seeded["headers"], first_order["id"])

    second_order = _create_sales_order(
        client,
        seeded["headers"],
        customer_id=seeded["customer_id"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        ordered_qty="5",
    )
    response = client.post(f"/sales-orders/{second_order['id']}/confirm", headers=seeded["headers"])

    assert response.status_code == 409
    assert response.json()["error_code"] == "INSUFFICIENT_AVAILABLE_STOCK"


def test_cancelling_sales_order_releases_reservation(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(
        client,
        db,
        email="sales-cancel@medhaone.app",
        batches=[("10", "SO-CANCEL-BATCH", "2030-12-31")],
    )
    order = _create_sales_order(
        client,
        seeded["headers"],
        customer_id=seeded["customer_id"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        ordered_qty="6",
    )
    _confirm_sales_order(client, seeded["headers"], order["id"])

    cancelled = client.post(f"/sales-orders/{order['id']}/cancel", headers=seeded["headers"])
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == SalesOrderStatus.CANCELLED.value

    reservation = db.query(StockReservation).filter(StockReservation.sales_order_id == order["id"]).one()
    assert reservation.status == StockReservationStatus.RELEASED
    assert Decimal(str(reservation.released_qty)) == Decimal("6")

    availability = client.get(
        "/reservations/availability",
        headers=seeded["headers"],
        params={"warehouse_id": seeded["warehouse_id"], "product_id": seeded["product_id"]},
    )
    assert availability.status_code == 200, availability.text
    assert Decimal(str(availability.json()["reserved_qty"])) == Decimal("0")
    assert Decimal(str(availability.json()["available_qty"])) == Decimal("10")


def test_create_dispatch_from_sales_order(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(
        client,
        db,
        email="sales-dispatch-create@medhaone.app",
        batches=[("10", "SO-DISPATCH-BATCH", "2030-12-31")],
    )
    order = _create_sales_order(
        client,
        seeded["headers"],
        customer_id=seeded["customer_id"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        ordered_qty="5",
    )
    confirmed = _confirm_sales_order(client, seeded["headers"], order["id"])

    dispatch = _create_dispatch(
        client,
        seeded["headers"],
        sales_order_id=order["id"],
        sales_order_line_id=confirmed["lines"][0]["id"],
        batch_id=seeded["batches"][0]["batch_id"],
        dispatched_qty="5",
    )

    assert dispatch["status"] == DispatchNoteStatus.DRAFT.value
    assert dispatch["sales_order_id"] == order["id"]
    assert dispatch["lines"][0]["batch_id"] == seeded["batches"][0]["batch_id"]
    assert Decimal(str(dispatch["lines"][0]["dispatched_qty"])) == Decimal("5")


def test_fefo_suggestion_returns_earliest_expiry_batch_first(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(
        client,
        db,
        email="sales-fefo@medhaone.app",
        batches=[
            ("5", "SO-FEFO-EARLY", "2030-01-31"),
            ("5", "SO-FEFO-LATE", "2030-06-30"),
        ],
    )

    response = client.get(
        "/reservations/availability",
        headers=seeded["headers"],
        params={"warehouse_id": seeded["warehouse_id"], "product_id": seeded["product_id"]},
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["batch_no"] for item in payload["candidate_batches"]] == [
        "SO-FEFO-EARLY",
        "SO-FEFO-LATE",
    ]


def test_dispatch_posting_reduces_physical_stock_and_consumes_reservation(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(
        client,
        db,
        email="sales-post@medhaone.app",
        batches=[("10", "SO-POST-BATCH", "2030-12-31")],
    )
    order = _create_sales_order(
        client,
        seeded["headers"],
        customer_id=seeded["customer_id"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        ordered_qty="6",
    )
    confirmed = _confirm_sales_order(client, seeded["headers"], order["id"])
    dispatch = _create_dispatch(
        client,
        seeded["headers"],
        sales_order_id=order["id"],
        sales_order_line_id=confirmed["lines"][0]["id"],
        batch_id=seeded["batches"][0]["batch_id"],
        dispatched_qty="4",
    )

    response = client.post(f"/dispatch-notes/{dispatch['id']}/post", headers=seeded["headers"])
    assert response.status_code == 200, response.text
    assert response.json()["status"] == DispatchNoteStatus.POSTED.value

    summary = (
        db.query(StockSummary)
        .filter(
            StockSummary.warehouse_id == seeded["warehouse_id"],
            StockSummary.product_id == seeded["product_id"],
            StockSummary.batch_id == seeded["batches"][0]["batch_id"],
        )
        .one()
    )
    assert Decimal(str(summary.qty_on_hand)) == Decimal("6")

    ledger = (
        db.query(InventoryLedger)
        .filter(
            InventoryLedger.reason == InventoryReason.SALES_DISPATCH,
            InventoryLedger.ref_id == dispatch["dispatch_number"],
        )
        .one()
    )
    assert Decimal(str(ledger.qty)) == Decimal("-4")

    reservation = db.query(StockReservation).filter(StockReservation.sales_order_id == order["id"]).one()
    assert Decimal(str(reservation.consumed_qty)) == Decimal("4")
    assert reservation.status == StockReservationStatus.PARTIALLY_CONSUMED


def test_partial_dispatch_updates_statuses_correctly(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(
        client,
        db,
        email="sales-partial@medhaone.app",
        batches=[("10", "SO-PARTIAL-BATCH", "2030-12-31")],
    )
    order = _create_sales_order(
        client,
        seeded["headers"],
        customer_id=seeded["customer_id"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        ordered_qty="6",
    )
    confirmed = _confirm_sales_order(client, seeded["headers"], order["id"])
    dispatch = _create_dispatch(
        client,
        seeded["headers"],
        sales_order_id=order["id"],
        sales_order_line_id=confirmed["lines"][0]["id"],
        batch_id=seeded["batches"][0]["batch_id"],
        dispatched_qty="4",
    )

    posted = client.post(f"/dispatch-notes/{dispatch['id']}/post", headers=seeded["headers"])
    assert posted.status_code == 200, posted.text

    sales_order = db.get(SalesOrder, order["id"])
    assert sales_order is not None
    assert sales_order.status == SalesOrderStatus.PARTIALLY_DISPATCHED
    assert Decimal(str(sales_order.lines[0].dispatched_qty)) == Decimal("4")
    assert Decimal(str(sales_order.lines[0].reserved_qty)) == Decimal("2")


def test_double_post_dispatch_is_blocked(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(
        client,
        db,
        email="sales-double-post@medhaone.app",
        batches=[("10", "SO-DOUBLE-BATCH", "2030-12-31")],
    )
    order = _create_sales_order(
        client,
        seeded["headers"],
        customer_id=seeded["customer_id"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        ordered_qty="5",
    )
    confirmed = _confirm_sales_order(client, seeded["headers"], order["id"])
    dispatch = _create_dispatch(
        client,
        seeded["headers"],
        sales_order_id=order["id"],
        sales_order_line_id=confirmed["lines"][0]["id"],
        batch_id=seeded["batches"][0]["batch_id"],
        dispatched_qty="5",
    )

    first_post = client.post(f"/dispatch-notes/{dispatch['id']}/post", headers=seeded["headers"])
    assert first_post.status_code == 200, first_post.text

    second_post = client.post(f"/dispatch-notes/{dispatch['id']}/post", headers=seeded["headers"])
    assert second_post.status_code == 409
    assert second_post.json()["error_code"] == "INVALID_STATE"


def test_dispatch_creation_cannot_overbook_split_lines(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_stock(
        client,
        db,
        email="sales-split-dispatch@medhaone.app",
        batches=[
            ("5", "SO-SPLIT-1", "2030-01-31"),
            ("5", "SO-SPLIT-2", "2030-06-30"),
        ],
    )
    order = _create_sales_order(
        client,
        seeded["headers"],
        customer_id=seeded["customer_id"],
        warehouse_id=seeded["warehouse_id"],
        product_id=seeded["product_id"],
        ordered_qty="6",
    )
    confirmed = _confirm_sales_order(client, seeded["headers"], order["id"])

    response = client.post(
        f"/dispatch-notes/from-sales-order/{order['id']}",
        headers=seeded["headers"],
        json={
            "dispatch_date": date.today().isoformat(),
            "lines": [
                {
                    "sales_order_line_id": confirmed["lines"][0]["id"],
                    "batch_id": seeded["batches"][0]["batch_id"],
                    "dispatched_qty": "4",
                },
                {
                    "sales_order_line_id": confirmed["lines"][0]["id"],
                    "batch_id": seeded["batches"][1]["batch_id"],
                    "dispatched_qty": "4",
                },
            ],
        },
    )

    assert response.status_code == 409
    assert response.json()["error_code"] == "INVALID_STATE"


def test_unauthorized_role_is_denied_sales_access(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    headers = create_restricted_headers(db, "sales-restricted@medhaone.app")

    response = client.get("/sales-orders", headers=headers)

    assert response.status_code == 403
    assert response.json()["error_code"] == "FORBIDDEN"
