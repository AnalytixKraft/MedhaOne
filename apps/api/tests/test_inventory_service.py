from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.models.batch import Batch
from app.models.enums import InventoryReason, PartyType
from app.models.inventory import StockSummary
from app.models.party import Party
from app.models.product import Product
from app.models.role import Role
from app.models.user import User
from app.models.warehouse import Warehouse
from app.services.inventory import InventoryError, stock_adjust, stock_in, stock_out


def create_reference_data(db: Session) -> dict[str, int]:
    role = Role(name="admin", is_active=True)
    db.add(role)
    db.flush()

    user = User(
        email="admin@test.com",
        full_name="Admin User",
        hashed_password="hashed",
        is_active=True,
        role_id=role.id,
    )
    db.add(user)

    warehouse = Warehouse(name="Main Store", code="MAIN", address="City", is_active=True)
    db.add(warehouse)

    product = Product(
        sku="SKU-001",
        name="Paracetamol 500",
        brand="AK",
        uom="BOX",
        is_active=True,
    )
    db.add(product)

    party = Party(name="Primary Distributor", party_type=PartyType.DISTRIBUTOR, is_active=True)
    db.add(party)

    db.flush()

    batch = Batch(
        product_id=product.id,
        batch_no="B001",
        expiry_date=date(2030, 12, 31),
        mfg_date=date(2026, 1, 1),
        mrp=Decimal("120.00"),
    )
    db.add(batch)
    db.commit()

    return {
        "user_id": user.id,
        "warehouse_id": warehouse.id,
        "product_id": product.id,
        "batch_id": batch.id,
    }


def get_summary_qty(db: Session, warehouse_id: int, product_id: int, batch_id: int) -> Decimal:
    summary = (
        db.query(StockSummary)
        .filter(StockSummary.warehouse_id == warehouse_id)
        .filter(StockSummary.product_id == product_id)
        .filter(StockSummary.batch_id == batch_id)
        .first()
    )
    assert summary is not None
    return Decimal(str(summary.qty_on_hand))


def test_stock_in_then_stock_out_success(db_session: Session) -> None:
    refs = create_reference_data(db_session)

    in_result = stock_in(
        db_session,
        warehouse_id=refs["warehouse_id"],
        product_id=refs["product_id"],
        batch_id=refs["batch_id"],
        qty=Decimal("10"),
        reason=InventoryReason.PURCHASE_GRN,
        created_by=refs["user_id"],
    )

    out_result = stock_out(
        db_session,
        warehouse_id=refs["warehouse_id"],
        product_id=refs["product_id"],
        batch_id=refs["batch_id"],
        qty=Decimal("4"),
        reason=InventoryReason.SALES_DISPATCH,
        created_by=refs["user_id"],
    )

    assert Decimal(str(in_result.ledger.qty)) == Decimal("10")
    assert Decimal(str(out_result.ledger.qty)) == Decimal("-4")
    assert get_summary_qty(
        db_session,
        refs["warehouse_id"],
        refs["product_id"],
        refs["batch_id"],
    ) == Decimal("6")


def test_stock_out_fails_when_insufficient_stock(db_session: Session) -> None:
    refs = create_reference_data(db_session)

    stock_in(
        db_session,
        warehouse_id=refs["warehouse_id"],
        product_id=refs["product_id"],
        batch_id=refs["batch_id"],
        qty=Decimal("2"),
        reason=InventoryReason.PURCHASE_GRN,
        created_by=refs["user_id"],
    )

    with pytest.raises(InventoryError, match="Insufficient stock"):
        stock_out(
            db_session,
            warehouse_id=refs["warehouse_id"],
            product_id=refs["product_id"],
            batch_id=refs["batch_id"],
            qty=Decimal("3"),
            reason=InventoryReason.SALES_DISPATCH,
            created_by=refs["user_id"],
        )

    assert get_summary_qty(
        db_session,
        refs["warehouse_id"],
        refs["product_id"],
        refs["batch_id"],
    ) == Decimal("2")


def test_stock_adjust_positive_and_negative(db_session: Session) -> None:
    refs = create_reference_data(db_session)

    positive_adjust = stock_adjust(
        db_session,
        warehouse_id=refs["warehouse_id"],
        product_id=refs["product_id"],
        batch_id=refs["batch_id"],
        delta_qty=Decimal("5"),
        created_by=refs["user_id"],
    )
    assert Decimal(str(positive_adjust.summary.qty_on_hand)) == Decimal("5")

    negative_adjust = stock_adjust(
        db_session,
        warehouse_id=refs["warehouse_id"],
        product_id=refs["product_id"],
        batch_id=refs["batch_id"],
        delta_qty=Decimal("-3"),
        created_by=refs["user_id"],
    )
    assert Decimal(str(negative_adjust.summary.qty_on_hand)) == Decimal("2")

    with pytest.raises(InventoryError, match="negative stock"):
        stock_adjust(
            db_session,
            warehouse_id=refs["warehouse_id"],
            product_id=refs["product_id"],
            batch_id=refs["batch_id"],
            delta_qty=Decimal("-5"),
            created_by=refs["user_id"],
        )
