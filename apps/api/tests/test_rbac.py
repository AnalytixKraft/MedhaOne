from collections.abc import Generator
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, get_password_hash
from app.models.batch import Batch
from app.models.user import User
from app.services.external_auth import get_or_create_rbac_shadow_user
from app.services.rbac import assign_roles_to_user, ensure_rbac_seeded
from conftest import TEST_TENANT_SLUG


def _create_user(
    db: Session,
    *,
    email: str,
    role_names: list[str],
    password: str = "ChangeMe123!",
    is_active: bool = True,
    is_superuser: bool = False,
    organization_slug: str | None = TEST_TENANT_SLUG,
) -> User:
    roles_by_name = ensure_rbac_seeded(db)
    role_ids = [roles_by_name[name].id for name in role_names]
    user = User(
        email=email,
        full_name=email.split("@")[0].replace(".", " ").title(),
        hashed_password=get_password_hash(password),
        is_active=is_active,
        is_superuser=is_superuser,
        organization_slug=organization_slug,
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


def _rbac_token(
    *, email: str, full_name: str, role: str, organization_id: str, user_id: str = "tenant-user-1"
) -> str:
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


def _create_batch(db: Session, *, product_id: int, batch_no: str) -> int:
    batch = Batch(
        product_id=product_id,
        batch_no=batch_no,
        expiry_date=date(2031, 12, 31),
        mfg_date=date(2026, 1, 1),
        mrp=Decimal("10.00"),
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch.id


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


def _create_grn(
    client: TestClient,
    headers: dict[str, str],
    *,
    po_id: int,
    po_line_id: int,
    received_qty: str = "5",
) -> dict:
    response = client.post(
        f"/purchase/grn/from-po/{po_id}",
        headers=headers,
        json={
            "lines": [
                {
                    "po_line_id": po_line_id,
                    "received_qty": received_qty,
                    "batch_no": f"GRN-BATCH-{po_id}",
                    "expiry_date": "2030-12-31",
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


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


def test_view_only_user_cannot_create_party(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    view_only_user = _create_user(
        db,
        email="view-only@medhaone.app",
        role_names=["VIEW_ONLY"],
    )
    headers = {"Authorization": f"Bearer {_token_for(view_only_user)}"}

    response = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "name": "Blocked Party",
            "party_type": "DISTRIBUTOR",
            "is_active": True,
        },
    )

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

    initial_me = client.get("/auth/me", headers=manager_headers)
    assert initial_me.status_code == 200, initial_me.text
    assert "purchase:approve" in initial_me.json()["permissions"]

    assign_response = client.post(
        f"/users/{manager_user.id}/roles",
        headers=admin_headers,
        json={"role_ids": [roles_by_name["VIEW_ONLY"].id]},
    )
    assert assign_response.status_code == 200, assign_response.text

    db.expire_all()
    reloaded = db.query(User).filter(User.id == manager_user.id).first()
    assert reloaded is not None
    assert "purchase:approve" not in reloaded.permissions

    updated_me = client.get("/auth/me", headers=manager_headers)
    assert updated_me.status_code == 200, updated_me.text
    assert "purchase:approve" not in updated_me.json()["permissions"]


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


def test_user_without_inventory_permissions_cannot_mutate_stock(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    admin_user = _create_user(db, email="admin-inventory@medhaone.app", role_names=["ADMIN"])
    restricted_user = _create_user(
        db,
        email="restricted-inventory@medhaone.app",
        role_names=[],
    )
    admin_headers = {"Authorization": f"Bearer {_token_for(admin_user)}"}
    restricted_headers = {"Authorization": f"Bearer {_token_for(restricted_user)}"}

    warehouse_id = _create_warehouse(client, admin_headers, "INVWH")
    product_id = _create_product(client, admin_headers, "INV-SKU-1")
    batch_id = _create_batch(db, product_id=product_id, batch_no="INV-BATCH-1")

    stock_in_response = client.post(
        "/inventory/in",
        headers=restricted_headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch_id,
            "qty": "5",
            "reason": "PURCHASE_GRN",
        },
    )
    assert stock_in_response.status_code == 403
    assert stock_in_response.json()["error_code"] == "FORBIDDEN"

    adjust_response = client.post(
        "/inventory/adjust",
        headers=restricted_headers,
        json={
            "warehouse_id": warehouse_id,
            "product_id": product_id,
            "batch_id": batch_id,
            "delta_qty": "1",
            "reason": "STOCK_ADJUSTMENT",
        },
    )
    assert adjust_response.status_code == 403
    assert adjust_response.json()["error_code"] == "FORBIDDEN"


def test_view_only_user_cannot_post_grn(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    admin_user = _create_user(db, email="admin-grn@medhaone.app", role_names=["ADMIN"])
    view_only_user = _create_user(
        db,
        email="view-grn@medhaone.app",
        role_names=["VIEW_ONLY"],
    )
    admin_headers = {"Authorization": f"Bearer {_token_for(admin_user)}"}
    view_headers = {"Authorization": f"Bearer {_token_for(view_only_user)}"}

    supplier_id = _create_supplier(client, admin_headers, "GRN Supplier")
    warehouse_id = _create_warehouse(client, admin_headers, "GRNWH")
    product_id = _create_product(client, admin_headers, "GRN-SKU-1")
    po = _create_po(
        client,
        admin_headers,
        supplier_id=supplier_id,
        warehouse_id=warehouse_id,
        product_id=product_id,
    )
    approve_response = client.post(f"/purchase/po/{po['id']}/approve", headers=admin_headers)
    assert approve_response.status_code == 200, approve_response.text
    grn = _create_grn(
        client,
        admin_headers,
        po_id=po["id"],
        po_line_id=po["lines"][0]["id"],
    )

    response = client.post(f"/purchase/grn/{grn['id']}/post", headers=view_headers)
    assert response.status_code == 403
    assert response.json()["error_code"] == "FORBIDDEN"


def test_user_without_reports_view_cannot_access_reports(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    restricted_user = _create_user(
        db,
        email="no-reports@medhaone.app",
        role_names=[],
    )

    response = client.get(
        "/reports/stock-inward",
        headers={"Authorization": f"Bearer {_token_for(restricted_user)}"},
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


@pytest.mark.parametrize(
    ("external_role", "expected_role", "expected_allowed", "expected_denied"),
    [
        ("PURCHASE_MANAGER", "PURCHASE_MANAGER", "purchase:approve", "inventory:adjust"),
        ("STORE_EXECUTIVE", "STORE_EXECUTIVE", "grn:post", "purchase:approve"),
        ("UNKNOWN_ROLE", "VIEW_ONLY", "reports:view", "purchase:approve"),
    ],
)
def test_rbac_shadow_user_maps_external_roles_safely(
    client_with_test_db: tuple[TestClient, Session],
    external_role: str,
    expected_role: str,
    expected_allowed: str,
    expected_denied: str,
) -> None:
    _client, db = client_with_test_db
    user = get_or_create_rbac_shadow_user(
        db,
        {
            "userId": f"{external_role.lower()}-user",
            "email": f"{external_role.lower()}@kraft.app",
            "fullName": "Mapped User",
            "role": external_role,
            "organizationId": "kraft",
        },
    )

    assert [role.name for role in user.effective_roles] == [expected_role]
    assert expected_allowed in user.permissions
    assert expected_denied not in user.permissions


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
