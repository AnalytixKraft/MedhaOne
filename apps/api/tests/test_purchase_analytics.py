from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.enums import PurchaseBillExtractionStatus, PurchaseBillStatus
from app.models.purchase_bill import PurchaseBill, PurchaseBillLine
from app.models.role import Role
from app.models.user import User
from app.testing import verify_gstin


def _create_access_user(db: Session, *, email: str, is_superuser: bool) -> str:
    role = Role(name=email.replace("@", "-"), is_active=True)
    db.add(role)
    db.flush()

    user = User(
        email=email,
        full_name=email.split("@")[0],
        hashed_password="not-used",
        is_active=True,
        is_superuser=is_superuser,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token(str(user.id))


def _create_supplier(client: TestClient, headers: dict[str, str], name: str) -> int:
    serial = (sum(ord(char) for char in name) % 9000) + 1000
    suffix = chr(65 + (sum(ord(char) for char in name) % 26))
    gstin = f"33ABCDE{serial:04d}{suffix}1Z5"
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": name,
            "party_type": "SUPPLIER",
            "party_category": "DISTRIBUTOR",
            "gstin": gstin,
            "gst_verification_log_id": verify_gstin(client, headers, gstin),
            "mobile": "9999999999",
            "state": "Tamil Nadu",
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


def _create_product(
    client: TestClient,
    headers: dict[str, str],
    *,
    sku: str,
    name: str,
    brand: str,
    category: str,
) -> int:
    brand_response = client.post(
        "/masters/brands",
        headers=headers,
        json={"name": brand, "is_active": True},
    )
    assert brand_response.status_code in (201, 400), brand_response.text
    response = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": sku,
            "name": name,
            "brand": brand,
            "category": category,
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
                    "free_qty": "0",
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


def _seed_posted_purchase_bill(
    db: Session,
    *,
    created_by: int,
    supplier_id: int,
    warehouse_id: int,
    purchase_order_id: int,
    product_id: int,
    qty: str,
    unit_price: str,
    bill_number: str,
    bill_date: date,
) -> None:
    qty_decimal = Decimal(qty)
    unit_price_decimal = Decimal(unit_price)
    line_total = qty_decimal * unit_price_decimal
    bill = PurchaseBill(
        bill_number=bill_number,
        supplier_id=supplier_id,
        bill_date=bill_date,
        warehouse_id=warehouse_id,
        status=PurchaseBillStatus.POSTED,
        subtotal=line_total,
        discount_amount=Decimal("0"),
        taxable_value=line_total,
        cgst_amount=Decimal("0"),
        sgst_amount=Decimal("0"),
        igst_amount=Decimal("0"),
        adjustment=Decimal("0"),
        total=line_total,
        extraction_status=PurchaseBillExtractionStatus.REVIEWED,
        purchase_order_id=purchase_order_id,
        created_by=created_by,
    )
    bill.lines.append(
        PurchaseBillLine(
            product_id=product_id,
            description_raw=f"Bill line for product {product_id}",
            qty=qty_decimal,
            unit="BOX",
            unit_price=unit_price_decimal,
            discount_amount=Decimal("0"),
            gst_percent=Decimal("0"),
            line_total=line_total,
        )
    )
    db.add(bill)
    db.commit()


def _seed_purchase_analytics_dataset(client: TestClient, db: Session) -> dict[str, object]:
    token = _create_access_user(db, email="purchase-analytics-admin@medhaone.app", is_superuser=True)
    headers = {"Authorization": f"Bearer {token}"}
    admin_user = db.query(User).filter(User.email == "purchase-analytics-admin@medhaone.app").one()

    fast_supplier_id = _create_supplier(client, headers, "Fast Supplier")
    slow_supplier_id = _create_supplier(client, headers, "Slow Supplier")
    fragmented_supplier_id = _create_supplier(client, headers, "Fragmented Supplier")
    warehouse_id = _create_warehouse(client, headers, "PAWH")

    product_a_id = _create_product(
        client,
        headers,
        sku="PA-PROD-A",
        name="Purchase Product A",
        brand="AK",
        category="Antibiotics",
    )
    product_b_id = _create_product(
        client,
        headers,
        sku="PA-PROD-B",
        name="Seasonal Product B",
        brand="AK",
        category="Seasonal",
    )
    product_c_id = _create_product(
        client,
        headers,
        sku="PA-PROD-C",
        name="Fragmented Product C",
        brand="AK",
        category="Critical",
    )

    po_fast = _create_po(
        client,
        headers,
        supplier_id=fast_supplier_id,
        warehouse_id=warehouse_id,
        order_date="2026-01-05",
        ordered_qty="10",
        unit_cost="10",
        product_id=product_a_id,
    )
    client.post(f"/purchase/po/{po_fast['id']}/approve", headers=headers)
    _create_and_post_grn(
        client,
        headers,
        po_id=po_fast["id"],
        po_line_id=po_fast["lines"][0]["id"],
        received_qty="10",
        batch_no="PA-A-1",
        expiry_date="2031-12-31",
        received_date="2026-01-07",
    )
    _seed_posted_purchase_bill(
        db,
        created_by=admin_user.id,
        supplier_id=fast_supplier_id,
        warehouse_id=warehouse_id,
        purchase_order_id=po_fast["id"],
        product_id=product_a_id,
        qty="10",
        unit_price="10",
        bill_number="PA-BILL-FAST-1",
        bill_date=date(2026, 1, 8),
    )

    po_slow = _create_po(
        client,
        headers,
        supplier_id=slow_supplier_id,
        warehouse_id=warehouse_id,
        order_date="2026-02-01",
        ordered_qty="10",
        unit_cost="12",
        product_id=product_a_id,
    )
    client.post(f"/purchase/po/{po_slow['id']}/approve", headers=headers)
    _create_and_post_grn(
        client,
        headers,
        po_id=po_slow["id"],
        po_line_id=po_slow["lines"][0]["id"],
        received_qty="4",
        batch_no="PA-A-2A",
        expiry_date="2031-12-31",
        received_date="2026-02-10",
    )
    _create_and_post_grn(
        client,
        headers,
        po_id=po_slow["id"],
        po_line_id=po_slow["lines"][0]["id"],
        received_qty="6",
        batch_no="PA-A-2B",
        expiry_date="2031-12-31",
        received_date="2026-02-15",
    )
    _seed_posted_purchase_bill(
        db,
        created_by=admin_user.id,
        supplier_id=slow_supplier_id,
        warehouse_id=warehouse_id,
        purchase_order_id=po_slow["id"],
        product_id=product_a_id,
        qty="10",
        unit_price="12",
        bill_number="PA-BILL-SLOW-1",
        bill_date=date(2026, 2, 16),
    )

    po_fallback = _create_po(
        client,
        headers,
        supplier_id=fast_supplier_id,
        warehouse_id=warehouse_id,
        order_date="2026-03-01",
        ordered_qty="5",
        unit_cost="11",
        product_id=product_a_id,
    )
    client.post(f"/purchase/po/{po_fallback['id']}/approve", headers=headers)
    _create_and_post_grn(
        client,
        headers,
        po_id=po_fallback["id"],
        po_line_id=po_fallback["lines"][0]["id"],
        received_qty="5",
        batch_no="PA-A-3",
        expiry_date="2031-12-31",
        received_date="2026-03-04",
    )

    po_seasonal_one = _create_po(
        client,
        headers,
        supplier_id=fast_supplier_id,
        warehouse_id=warehouse_id,
        order_date="2026-01-10",
        ordered_qty="2",
        unit_cost="5",
        product_id=product_b_id,
    )
    client.post(f"/purchase/po/{po_seasonal_one['id']}/approve", headers=headers)
    _create_and_post_grn(
        client,
        headers,
        po_id=po_seasonal_one["id"],
        po_line_id=po_seasonal_one["lines"][0]["id"],
        received_qty="2",
        batch_no="PA-B-1",
        expiry_date="2031-12-31",
        received_date="2026-01-12",
    )
    _seed_posted_purchase_bill(
        db,
        created_by=admin_user.id,
        supplier_id=fast_supplier_id,
        warehouse_id=warehouse_id,
        purchase_order_id=po_seasonal_one["id"],
        product_id=product_b_id,
        qty="2",
        unit_price="5",
        bill_number="PA-BILL-SEASON-1",
        bill_date=date(2026, 1, 12),
    )

    po_seasonal_two = _create_po(
        client,
        headers,
        supplier_id=fast_supplier_id,
        warehouse_id=warehouse_id,
        order_date="2026-06-01",
        ordered_qty="20",
        unit_cost="5",
        product_id=product_b_id,
    )
    client.post(f"/purchase/po/{po_seasonal_two['id']}/approve", headers=headers)
    _create_and_post_grn(
        client,
        headers,
        po_id=po_seasonal_two["id"],
        po_line_id=po_seasonal_two["lines"][0]["id"],
        received_qty="20",
        batch_no="PA-B-2",
        expiry_date="2031-12-31",
        received_date="2026-06-03",
    )
    _seed_posted_purchase_bill(
        db,
        created_by=admin_user.id,
        supplier_id=fast_supplier_id,
        warehouse_id=warehouse_id,
        purchase_order_id=po_seasonal_two["id"],
        product_id=product_b_id,
        qty="20",
        unit_price="5",
        bill_number="PA-BILL-SEASON-2",
        bill_date=date(2026, 6, 3),
    )

    po_fragmented = _create_po(
        client,
        headers,
        supplier_id=fragmented_supplier_id,
        warehouse_id=warehouse_id,
        order_date="2026-04-01",
        ordered_qty="10",
        unit_cost="9",
        product_id=product_c_id,
    )
    client.post(f"/purchase/po/{po_fragmented['id']}/approve", headers=headers)
    _create_and_post_grn(
        client,
        headers,
        po_id=po_fragmented["id"],
        po_line_id=po_fragmented["lines"][0]["id"],
        received_qty="5",
        batch_no="PA-C-1",
        expiry_date="2031-12-31",
        received_date="2026-04-05",
    )
    _create_and_post_grn(
        client,
        headers,
        po_id=po_fragmented["id"],
        po_line_id=po_fragmented["lines"][0]["id"],
        received_qty="3",
        batch_no="PA-C-2",
        expiry_date="2031-12-31",
        received_date="2026-04-10",
    )

    return {
        "headers": headers,
        "fast_supplier_id": fast_supplier_id,
        "slow_supplier_id": slow_supplier_id,
        "fragmented_supplier_id": fragmented_supplier_id,
        "product_a_id": product_a_id,
        "product_b_id": product_b_id,
        "product_c_id": product_c_id,
    }


def test_purchase_cost_trend_returns_monthly_rate_history_correctly(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_purchase_analytics_dataset(client, db)

    response = client.get(
        "/reports/purchase-analytics/purchase-cost-trend",
        headers=seeded["headers"],
        params={"product_id": seeded["product_a_id"]},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    monthly_rates = {row["month"]: Decimal(str(row["avg_purchase_rate"])) for row in payload["data"]}
    assert monthly_rates["Jan 2026"] == Decimal("10")
    assert monthly_rates["Feb 2026"] == Decimal("12")
    assert monthly_rates["Mar 2026"] == Decimal("11")


def test_seasonal_report_identifies_peak_month_correctly(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_purchase_analytics_dataset(client, db)

    response = client.get(
        "/reports/purchase-analytics/seasonal-purchase-pattern",
        headers=seeded["headers"],
        params={"product_id": seeded["product_b_id"], "year": 2026},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    june_row = next(row for row in payload["data"] if row["month"] == "Jun 2026")
    assert Decimal(str(june_row["purchase_qty"])) == Decimal("20")
    assert june_row["peak_month_flag"] is True


def test_supplier_lead_time_calculates_po_to_grn_days_correctly(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_purchase_analytics_dataset(client, db)

    response = client.get(
        "/reports/purchase-analytics/supplier-lead-time",
        headers=seeded["headers"],
        params={"supplier_id": seeded["slow_supplier_id"]},
    )

    assert response.status_code == 200, response.text
    row = response.json()["data"][0]
    assert Decimal(str(row["avg_days_to_first_grn"])) == Decimal("9")
    assert Decimal(str(row["avg_days_to_full_receipt"])) == Decimal("14")


def test_supplier_price_comparison_ranks_suppliers_correctly(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_purchase_analytics_dataset(client, db)

    response = client.get(
        "/reports/purchase-analytics/supplier-price-comparison",
        headers=seeded["headers"],
        params={"product_id": seeded["product_a_id"]},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    fast_row = next(row for row in payload["data"] if row["supplier"] == "Fast Supplier")
    slow_row = next(row for row in payload["data"] if row["supplier"] == "Slow Supplier")
    assert fast_row["rank"] == 1
    assert slow_row["rank"] == 2


def test_po_fulfillment_report_computes_fill_rate_and_split_count_correctly(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    seeded = _seed_purchase_analytics_dataset(client, db)

    response = client.get(
        "/reports/purchase-analytics/po-fulfillment-quality",
        headers=seeded["headers"],
        params={"supplier_id": seeded["fragmented_supplier_id"]},
    )

    assert response.status_code == 200, response.text
    row = response.json()["data"][0]
    assert Decimal(str(row["fill_rate_pct"])) == Decimal("80")
    assert Decimal(str(row["avg_grn_count_per_po"])) == Decimal("2")
    assert Decimal(str(row["partial_receipt_frequency"])) == Decimal("100")


def test_purchase_analytics_unauthorized_user_denied(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db, email="purchase-analytics-limited@medhaone.app", is_superuser=False)
    headers = {"Authorization": f"Bearer {token}"}

    response = client.get("/reports/purchase-analytics/purchase-cost-trend", headers=headers)

    assert response.status_code == 403, response.text
