from collections.abc import Generator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.config import get_settings
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.base import Base
from app.models.user import User
from app.services.external_auth import get_or_create_rbac_shadow_user
from app.services.rbac import assign_roles_to_user, ensure_rbac_seeded


def _create_user(
    db: Session,
    *,
    email: str,
    role_names: list[str],
    password: str = "ChangeMe123!",
    is_active: bool = True,
    is_superuser: bool = False,
) -> User:
    roles_by_name = ensure_rbac_seeded(db)
    role_ids = [roles_by_name[name].id for name in role_names]
    user = User(
        email=email,
        full_name=email.split("@")[0].replace(".", " ").title(),
        hashed_password=get_password_hash(password),
        is_active=is_active,
        is_superuser=is_superuser,
        role_id=role_ids[0] if role_ids else None,
    )
    db.add(user)
    db.flush()
    assign_roles_to_user(db, user, role_ids)
    db.commit()
    db.refresh(user)
    return user


def _token_for(user: User) -> str:
    return create_access_token(str(user.id))


def _rbac_token(*, email: str, full_name: str, role: str, organization_id: str, user_id: str = "tenant-user-1") -> str:
    settings = get_settings()
    payload = {
        "userId": user_id,
        "email": email,
        "fullName": full_name,
        "role": role,
        "organizationId": organization_id,
        "schemaName": f"org_{organization_id}",
        "sudoFlag": False,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return jwt.encode(payload, settings.rbac_jwt_secret, algorithm="HS256")


def _create_supplier(client: TestClient, headers: dict[str, str], name: str) -> int:
    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "name": name,
            "party_type": "SUPER_STOCKIST",
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
    product_id: int,
) -> dict:
    response = client.post(
        "/purchase/po",
        headers=headers,
        json={
            "supplier_id": supplier_id,
            "warehouse_id": warehouse_id,
            "order_date": "2026-02-28",
            "lines": [
                {
                    "product_id": product_id,
                    "ordered_qty": "5",
                    "unit_cost": "10.00",
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
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


def test_admin_can_approve_po(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    admin_user = _create_user(db, email="admin-role@medhaone.app", role_names=["ADMIN"])
    headers = {"Authorization": f"Bearer {_token_for(admin_user)}"}

    supplier_id = _create_supplier(client, headers, "Admin Supplier")
    warehouse_id = _create_warehouse(client, headers, "ADMWH")
    product_id = _create_product(client, headers, "ADM-SKU-1")
    po = _create_po(
        client,
        headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
    )

    response = client.post(f"/purchase/po/{po['id']}/approve", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "APPROVED"


def test_store_user_cannot_approve_po(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    admin_user = _create_user(db, email="admin-store@medhaone.app", role_names=["ADMIN"])
    store_user = _create_user(
        db,
        email="store-user@medhaone.app",
        role_names=["STORE_EXECUTIVE"],
    )
    admin_headers = {"Authorization": f"Bearer {_token_for(admin_user)}"}
    store_headers = {"Authorization": f"Bearer {_token_for(store_user)}"}

    supplier_id = _create_supplier(client, admin_headers, "Store Supplier")
    warehouse_id = _create_warehouse(client, admin_headers, "STOWH")
    product_id = _create_product(client, admin_headers, "STO-SKU-1")
    po = _create_po(
        client,
        admin_headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
    )

    response = client.post(f"/purchase/po/{po['id']}/approve", headers=store_headers)
    assert response.status_code == 403
    assert response.json()["error_code"] == "FORBIDDEN"


def test_inactive_user_cannot_login(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    _create_user(
        db,
        email="inactive-user@medhaone.app",
        role_names=["VIEW_ONLY"],
        password="Inactive123!",
        is_active=False,
    )

    response = client.post(
        "/auth/login",
        json={"email": "inactive-user@medhaone.app", "password": "Inactive123!"},
    )
    assert response.status_code == 403
    assert response.json()["error_code"] == "FORBIDDEN"


def test_removing_role_removes_access(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    admin_user = _create_user(db, email="admin-rm@medhaone.app", role_names=["ADMIN"])
    manager_user = _create_user(
        db,
        email="manager-rm@medhaone.app",
        role_names=["PURCHASE_MANAGER"],
    )
    roles_by_name = ensure_rbac_seeded(db)
    db.commit()

    admin_headers = {"Authorization": f"Bearer {_token_for(admin_user)}"}
    manager_headers = {"Authorization": f"Bearer {_token_for(manager_user)}"}

    supplier_id = _create_supplier(client, admin_headers, "Role Supplier")
    warehouse_id = _create_warehouse(client, admin_headers, "RMRWH")
    product_id = _create_product(client, admin_headers, "RMR-SKU-1")

    first_po = _create_po(
        client,
        manager_headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
    )
    first_approve = client.post(f"/purchase/po/{first_po['id']}/approve", headers=manager_headers)
    assert first_approve.status_code == 200, first_approve.text

    second_po = _create_po(
        client,
        admin_headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
    )

    assign_response = client.post(
        f"/users/{manager_user.id}/roles",
        headers=admin_headers,
        json={"role_ids": [roles_by_name["VIEW_ONLY"].id]},
    )
    assert assign_response.status_code == 200, assign_response.text

    second_approve = client.post(f"/purchase/po/{second_po['id']}/approve", headers=manager_headers)
    assert second_approve.status_code == 403
    assert second_approve.json()["error_code"] == "FORBIDDEN"


def test_user_manage_permission_required_to_create_user(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    purchase_user = _create_user(
        db,
        email="purchase-user@medhaone.app",
        role_names=["PURCHASE_MANAGER"],
    )
    headers = {"Authorization": f"Bearer {_token_for(purchase_user)}"}
    roles_by_name = ensure_rbac_seeded(db)
    db.commit()

    response = client.post(
        "/users/",
        headers=headers,
        json={
            "email": "new-user@medhaone.app",
            "password": "ChangeMe123!",
            "full_name": "New User",
            "role_ids": [roles_by_name["VIEW_ONLY"].id],
        },
    )
    assert response.status_code == 403
    assert response.json()["error_code"] == "FORBIDDEN"


def test_auth_me_accepts_rbac_token_and_creates_shadow_user(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    token = _rbac_token(
        email="org-admin@kraft.app",
        full_name="Kraft Org Admin",
        role="ORG_ADMIN",
        organization_id="kraft",
    )

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["email"] == "org-admin@kraft.app"
    assert payload["full_name"] == "Kraft Org Admin"
    assert "purchase:approve" in payload["permissions"]

    shadow_user = db.query(User).filter(User.external_subject == "rbac:kraft:tenant-user-1").first()
    assert shadow_user is not None
    assert shadow_user.auth_provider == "RBAC"
    assert shadow_user.organization_slug == "kraft"


def test_auth_login_brokers_tenant_login(
    client_with_test_db: tuple[TestClient, Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _db = client_with_test_db
    brokered_token = "rbac-token-from-broker"

    def _fake_login_via_rbac(*, email: str, password: str, organization_slug: str) -> str:
        assert email == "org-admin@kraft.app"
        assert password == "TenantPass123!"
        assert organization_slug == "kraft"
        return brokered_token

    monkeypatch.setattr("app.api.routes.auth.login_via_rbac", _fake_login_via_rbac)

    response = client.post(
        "/auth/login",
        json={
            "email": "org-admin@kraft.app",
            "password": "TenantPass123!",
            "organization_slug": "kraft",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["access_token"] == brokered_token


def test_auth_login_discovers_tenant_without_org_slug(
    client_with_test_db: tuple[TestClient, Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _db = client_with_test_db
    brokered_token = "rbac-token-discovered"

    def _fake_login_via_rbac(*, email: str, password: str, organization_slug: str | None) -> str:
        assert email == "shared-admin@kraft.app"
        assert password == "TenantPass123!"
        assert organization_slug is None
        return brokered_token

    monkeypatch.setattr("app.api.routes.auth.login_via_rbac", _fake_login_via_rbac)

    response = client.post(
        "/auth/login",
        json={
            "email": "shared-admin@kraft.app",
            "password": "TenantPass123!",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["access_token"] == brokered_token


def test_rbac_shadow_user_reuses_email_across_org_switches(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    _client, db = client_with_test_db
    first = get_or_create_rbac_shadow_user(
        db,
        {
            "userId": "tenant-user-1",
            "email": "shared-admin@kraft.app",
            "fullName": "Shared Admin",
            "role": "ORG_ADMIN",
            "organizationId": "kraft",
        },
    )
    second = get_or_create_rbac_shadow_user(
        db,
        {
            "userId": "tenant-user-2",
            "email": "shared-admin@kraft.app",
            "fullName": "Shared Admin",
            "role": "ORG_ADMIN",
            "organizationId": "alpha",
        },
    )

    assert first.id == second.id
    assert second.organization_slug == "alpha"
    assert second.external_subject == "rbac:alpha:tenant-user-2"
