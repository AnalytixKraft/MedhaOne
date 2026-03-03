from sqlalchemy.orm import Session

from app.core.security import create_access_token, get_password_hash
from app.models.user import User
from app.services.rbac import assign_roles_to_user, ensure_rbac_seeded
from conftest import TEST_TENANT_NAME, TEST_TENANT_SLUG


def _create_user(
    db: Session,
    *,
    email: str,
    role_name: str,
    organization_slug: str = TEST_TENANT_SLUG,
) -> User:
    roles_by_name = ensure_rbac_seeded(db)
    role = roles_by_name[role_name]
    user = User(
        email=email,
        full_name=email.split("@")[0].replace(".", " ").title(),
        hashed_password=get_password_hash("ChangeMe123!"),
        is_active=True,
        is_superuser=False,
        organization_slug=organization_slug,
        role_id=role.id,
    )
    db.add(user)
    db.flush()
    assign_roles_to_user(db, user, [role.id])
    db.commit()
    db.refresh(user)
    return user


def _token_for(user: User) -> str:
    return create_access_token(str(user.id))


def test_org_admin_can_update_company_settings(
    client_with_test_db: tuple["TestClient", Session],
) -> None:
    client, session = client_with_test_db
    user = _create_user(session, email="orgadmin@tenant.app", role_name="ORG_ADMIN")
    headers = {"Authorization": f"Bearer {_token_for(user)}"}

    get_response = client.get("/settings/company", headers=headers)
    assert get_response.status_code == 200, get_response.text
    assert get_response.json()["organization_name"] == TEST_TENANT_NAME

    update_response = client.put(
        "/settings/company",
        headers=headers,
        json={
            "company_name": "Tenant One Healthcare",
            "city": "Kochi",
            "state": "Kerala",
            "phone": "9999999999",
        },
    )
    assert update_response.status_code == 200, update_response.text
    body = update_response.json()
    assert body["company_name"] == "Tenant One Healthcare"
    assert body["city"] == "Kochi"
    assert body["state"] == "Kerala"
    assert body["phone"] == "9999999999"


def test_service_support_is_read_only_for_company_settings(
    client_with_test_db: tuple["TestClient", Session],
) -> None:
    client, session = client_with_test_db
    user = _create_user(session, email="support@tenant.app", role_name="SERVICE_SUPPORT")
    headers = {"Authorization": f"Bearer {_token_for(user)}"}

    get_response = client.get("/settings/company", headers=headers)
    assert get_response.status_code == 200, get_response.text

    update_response = client.put(
        "/settings/company",
        headers=headers,
        json={"company_name": "Blocked Update"},
    )
    assert update_response.status_code == 403
    assert update_response.json()["error_code"] == "FORBIDDEN"


def test_read_write_is_read_only_for_company_settings(
    client_with_test_db: tuple["TestClient", Session],
) -> None:
    client, session = client_with_test_db
    user = _create_user(session, email="operator@tenant.app", role_name="READ_WRITE")
    headers = {"Authorization": f"Bearer {_token_for(user)}"}

    get_response = client.get("/settings/company", headers=headers)
    assert get_response.status_code == 200, get_response.text

    update_response = client.put(
        "/settings/company",
        headers=headers,
        json={"company_name": "Blocked Update"},
    )
    assert update_response.status_code == 403
    assert update_response.json()["error_code"] == "FORBIDDEN"
