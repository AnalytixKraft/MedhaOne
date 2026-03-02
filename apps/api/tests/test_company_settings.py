from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db, resolve_request_tenant_schema
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.base import Base
from app.models.user import User
from app.services.rbac import assign_roles_to_user, ensure_rbac_seeded


def _create_user(
    db: Session,
    *,
    email: str,
    role_name: str,
    organization_slug: str = "tenant_one",
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


def test_org_admin_can_update_company_settings() -> None:
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
    app.dependency_overrides[resolve_request_tenant_schema] = lambda: "org_tenant_one"
    client = TestClient(app)

    try:
        user = _create_user(session, email="orgadmin@tenant.app", role_name="ORG_ADMIN")
        headers = {"Authorization": f"Bearer {_token_for(user)}"}

        get_response = client.get("/settings/company", headers=headers)
        assert get_response.status_code == 200, get_response.text
        assert get_response.json()["organization_name"] == "Tenant One"

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
    finally:
        app.dependency_overrides.clear()
        client.close()
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_service_support_is_read_only_for_company_settings() -> None:
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
    app.dependency_overrides[resolve_request_tenant_schema] = lambda: "org_tenant_one"
    client = TestClient(app)

    try:
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
    finally:
        app.dependency_overrides.clear()
        client.close()
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_read_write_is_read_only_for_company_settings() -> None:
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
    app.dependency_overrides[resolve_request_tenant_schema] = lambda: "org_tenant_one"
    client = TestClient(app)

    try:
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
    finally:
        app.dependency_overrides.clear()
        client.close()
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
