from collections.abc import Generator
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.base import Base
from app.models.batch import Batch
from app.models.inventory import StockSummary
from app.models.role import Role
from app.models.user import User


def _create_access_user(db: Session) -> str:
    role = Role(name="admin", is_active=True)
    db.add(role)
    db.flush()

    user = User(
        email="smoke-admin@medhaone.app",
        full_name="Smoke Admin",
        hashed_password="not-used-in-token-smoke",
        is_active=True,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return create_access_token(str(user.id))


def _get_stock_summary(
    db: Session,
    warehouse_id: int,
    product_id: int,
    batch_id: int,
) -> StockSummary:
    summary = (
        db.query(StockSummary)
        .filter(StockSummary.warehouse_id == warehouse_id)
        .filter(StockSummary.product_id == product_id)
        .filter(StockSummary.batch_id == batch_id)
        .first()
    )
    assert summary is not None
    return summary


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


def test_inventory_endpoints_smoke(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    token = _create_access_user(db)
    headers = {"Authorization": f"Bearer {token}"}

    product_resp = client.post(
        "/masters/products",
        headers=headers,
        json={
            "sku": "SMOKE-PAR-001",
            "name": "Paracetamol Smoke",
            "brand": "AK",
            "uom": "BOX",
            "is_active": True,
        },
    )
    assert product_resp.status_code == 201, product_resp.text
    product_id = product_resp.json()["id"]

    warehouse_resp = client.post(
        "/masters/warehouses",
        headers=headers,
        json={"name": "Smoke Main", "code": "SMKMAIN", "address": "Test Zone", "is_active": True},
    )
    assert warehouse_resp.status_code == 201, warehouse_resp.text
    warehouse_id = warehouse_resp.json()["id"]

    batch = Batch(
        product_id=product_id,
        batch_no="SMK-B1",
        expiry_date=date(2030, 12, 31),
        mfg_date=date(2026, 1, 1),
        mrp=Decimal("99.00"),
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)

    stock_in_resp = client.post(
        "/inventory/in",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch.id,
            "qty": "10",
            "reason": "PURCHASE_GRN",
        },
    )
    assert stock_in_resp.status_code == 200, stock_in_resp.text

    stock_out_resp = client.post(
        "/inventory/out",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch.id,
            "qty": "4",
            "reason": "SALES_DISPATCH",
        },
    )
    assert stock_out_resp.status_code == 200, stock_out_resp.text

    summary = _get_stock_summary(
        db,
        warehouse_id=warehouse_id,
        product_id=product_id,
        batch_id=batch.id,
    )
    assert Decimal(str(summary.qty_on_hand)) == Decimal("6")

    insufficient_resp = client.post(
        "/inventory/out",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch.id,
            "qty": "7",
            "reason": "SALES_DISPATCH",
        },
    )
    assert insufficient_resp.status_code == 400
    assert "Insufficient stock" in insufficient_resp.json()["detail"]
