from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import text

from app.api.deps import resolve_request_tenant_schema
from app.api.routes.test_tools import _ensure_test_user, _reset_test_tenant_schema
from app.core.config import get_settings
from app.core.database import SessionLocal, reset_search_path, set_tenant_search_path
from app.core.exceptions import AppException
from app.core.security import create_access_token
from app.core.tenancy import build_tenant_schema_name, validate_org_slug
from app.core import tenant as tenant_module
from app.core.tenant import (
    ensure_tenant_db_context,
    run_in_tenant_schema,
    validate_tenant_header_or_raise,
)
from app.main import app
from app.models.user import User
from app.routers.public_router import PUBLIC_SCOPED_PREFIXES
from app.routers.tenant_router import tenant_router
from app.services import tenancy as tenancy_service


class _FakeResult:
    def __init__(self, row: dict[str, Any] | None = None, scalar: Any = None):
        self._row = row
        self._scalar = scalar

    def mappings(self) -> _FakeResult:
        return self

    def first(self) -> dict[str, Any] | None:
        return self._row

    def scalar_one_or_none(self) -> Any:
        return self._scalar

    def scalar_one(self) -> Any:
        return self._scalar


class _FakeQuery:
    def __init__(self, user: Any = None):
        self._user = user

    def filter(self, *_args, **_kwargs) -> _FakeQuery:
        return self

    def first(self):
        return self._user


class _FakeSession:
    def __init__(
        self,
        *,
        row: dict[str, Any] | None = None,
        schema_exists: bool = True,
        user: Any = None,
    ):
        self.row = row
        self.schema_exists = schema_exists
        self.user = user
        self.statements: list[tuple[str, dict[str, Any] | None]] = []
        self.info: dict[str, Any] = {}
        self.committed = False
        self.rolled_back = False

    def execute(self, statement, params: dict[str, Any] | None = None):
        sql = str(statement)
        self.statements.append((sql, params))
        if "SELECT id, schema_name, is_active" in sql:
            return _FakeResult(self.row)
        if "FROM information_schema.schemata" in sql:
            return _FakeResult(scalar=1 if self.schema_exists else None)
        if "SELECT current_setting('search_path')" in sql:
            tenant_schema = self.info.get("tenant_schema")
            value = f"{tenant_schema}, public" if tenant_schema else "public"
            return _FakeResult(scalar=value)
        return _FakeResult()

    def query(self, _model):
        return _FakeQuery(self.user)

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        return None


class _FakeSessionFactory:
    def __init__(self, sessions: list[_FakeSession]):
        self._sessions = list(sessions)

    def __call__(self):
        outer = self

        class _ContextManager:
            def __enter__(self):
                if not outer._sessions:
                    raise AssertionError("No fake sessions left")
                self.session = outer._sessions.pop(0)
                return self.session

            def __exit__(self, *_args):
                self.session.close()
                return False

        return _ContextManager()


def _rbac_token(organization_id: str, *, schema_name: str | None = None) -> str:
    settings = get_settings()
    payload = {
        "userId": "tenant-user-1",
        "email": "org-admin@tenant.app",
        "fullName": "Org Admin",
        "role": "ORG_ADMIN",
        "organizationId": organization_id,
        "schemaName": schema_name or f"org_{organization_id}",
    }
    return jwt.encode(payload, settings.rbac_jwt_secret, algorithm="HS256")


def test_validate_org_slug_rejects_invalid_values() -> None:
    with pytest.raises(AppException) as caught:
        validate_org_slug("alpha-beta")

    assert caught.value.error_code == "INVALID_ORG"


def test_resolve_request_tenant_schema_uses_token_context_and_public_org_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.core.tenant.IS_POSTGRES", True)
    session = _FakeSession(
        row={
            "id": "kraft",
            "schema_name": "org_kraft",
            "is_active": True,
        }
    )

    schema_name = resolve_request_tenant_schema(
        payload={"organizationId": "kraft", "schemaName": "org_kraft"},
        db=session,
    )

    assert schema_name == "org_kraft"
    assert session.statements[0][1] == {"org_slug": "kraft"}


def test_resolve_request_tenant_schema_rejects_mismatched_schema_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.core.tenant.IS_POSTGRES", True)
    session = _FakeSession(
        row={
            "id": "kraft",
            "schema_name": "org_kraft",
            "is_active": True,
        }
    )

    with pytest.raises(AppException) as caught:
        resolve_request_tenant_schema(
            payload={"organizationId": "kraft", "schemaName": "org_alpha"},
            db=session,
        )

    assert caught.value.error_code == "FORBIDDEN"


def test_two_org_tokens_bind_distinct_request_schemas(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.core.tenant.IS_POSTGRES", True)

    first = resolve_request_tenant_schema(
        payload={"organizationId": "alpha", "schemaName": "org_alpha"},
        db=_FakeSession(row={"id": "alpha", "schema_name": "org_alpha", "is_active": True}),
    )
    second = resolve_request_tenant_schema(
        payload={"organizationId": "beta", "schemaName": "org_beta"},
        db=_FakeSession(row={"id": "beta", "schema_name": "org_beta", "is_active": True}),
    )

    assert first == "org_alpha"
    assert second == "org_beta"
    assert first != second


def test_tenant_router_structurally_enforces_schema_binding() -> None:
    dependencies = [dependency.dependency for dependency in tenant_router.dependencies]
    assert ensure_tenant_db_context in dependencies
    assert "/users" not in PUBLIC_SCOPED_PREFIXES


def test_search_path_is_applied_and_reset_per_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.core.database.IS_POSTGRES", True)
    session = _FakeSession()

    set_tenant_search_path(session, "org_alpha")
    reset_search_path(session)

    assert 'SET search_path TO "org_alpha", public' in session.statements[0][0]
    assert "SET search_path TO public" in session.statements[1][0]
    assert "tenant_schema" not in session.info


def test_simulated_postgres_schema_isolation_smoke_between_tenants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.core.tenant.IS_POSTGRES", True)
    monkeypatch.setattr("app.core.database.IS_POSTGRES", True)
    alpha_session = _FakeSession(
        row={"id": "alpha", "schema_name": "org_alpha", "is_active": True},
    )
    beta_session = _FakeSession(
        row={"id": "beta", "schema_name": "org_beta", "is_active": True},
    )
    monkeypatch.setattr(
        "app.core.tenant.SessionLocal",
        _FakeSessionFactory([alpha_session, beta_session]),
    )

    data_by_schema: dict[str, list[str]] = {}

    def _write_inventory(db: _FakeSession) -> int:
        current_schema = str(db.info["tenant_schema"])
        data_by_schema.setdefault(current_schema, []).append("stock-entry")
        return len(data_by_schema[current_schema])

    def _read_inventory(db: _FakeSession) -> int:
        current_schema = str(db.info["tenant_schema"])
        return len(data_by_schema.get(current_schema, []))

    written = run_in_tenant_schema("alpha", _write_inventory)
    visible_in_beta = run_in_tenant_schema("beta", _read_inventory)

    assert written == 1
    assert visible_in_beta == 0
    assert alpha_session.committed is True
    assert beta_session.committed is True


def test_invalid_schema_slug_in_request_header_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = _rbac_token("alpha-beta", schema_name="org_alpha-beta")

    with pytest.raises(AppException) as caught:
        validate_tenant_header_or_raise(f"Bearer {token}")

    assert caught.value.error_code == "INVALID_ORG"


def test_run_tenant_schema_migrations_passes_target_schema_to_alembic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.services.tenancy.IS_POSTGRES", True)
    captured: dict[str, Any] = {}

    def _fake_upgrade(config, revision: str) -> None:
        captured["revision"] = revision
        captured["schema"] = config.attributes["schema"]

    monkeypatch.setattr(tenancy_service.command, "upgrade", _fake_upgrade)

    tenancy_service.run_tenant_schema_migrations("org_kraft")

    assert captured == {"revision": "head", "schema": "org_kraft"}


def test_provision_organization_schema_creates_schema_and_runs_migrations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.services.tenancy.IS_POSTGRES", True)
    session = _FakeSession()
    called: dict[str, Any] = {}
    seeded: dict[str, Any] = {}

    def _fake_run(schema_name: str) -> None:
        called["schema"] = schema_name

    def _fake_seed(schema_name: str) -> None:
        seeded["schema"] = schema_name

    monkeypatch.setattr("app.services.tenancy.run_tenant_schema_migrations", _fake_run)
    monkeypatch.setattr("app.services.tenancy.seed_tenant_tax_rates_for_schema", _fake_seed)

    schema_name = tenancy_service.provision_organization_schema(
        session,
        slug="kraft",
        name="Kraft",
        max_users=10,
        created_by_id=1,
    )

    assert schema_name == build_tenant_schema_name("kraft")
    assert session.committed is True
    assert any("INSERT INTO public.organizations" in sql for sql, _ in session.statements)
    assert any('CREATE SCHEMA IF NOT EXISTS "org_kraft"' in sql for sql, _ in session.statements)
    assert called["schema"] == "org_kraft"
    assert seeded["schema"] == "org_kraft"


def test_tenant_request_syncs_public_user_roles_before_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.core.tenant.settings.enable_test_endpoints", True)
    org_slug = "e2e_tenant_sync"
    schema_name = build_tenant_schema_name(org_slug)
    client = TestClient(app)

    try:
        _reset_test_tenant_schema(org_slug, "E2E Tenant Sync")
        _ensure_test_user(org_slug)

        with SessionLocal() as db:
            user = db.query(User).filter(User.email == "e2e.admin@medhaone.app").one()
            token = create_access_token(str(user.id))

        response = client.post(
            "/masters/parties",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name": "Tenant Sync Supplier",
                "party_type": "SUPER_STOCKIST",
                "phone": "9999999999",
                "is_active": True,
            },
        )

        assert response.status_code == 201, response.text

        with SessionLocal() as db:
            db.execute(text(f'SET search_path TO "{schema_name}", public'))
            tenant_user = db.get(User, user.id)
            assert tenant_user is not None
            assert tenant_user.role_id is not None
    finally:
        client.close()
        with SessionLocal() as db:
            db.execute(text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE'))
            db.execute(text("DELETE FROM public.organizations WHERE id = :org_slug"), {"org_slug": org_slug})
            db.commit()


def test_tenant_request_supports_legacy_tenant_user_table(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.core.tenant.settings.enable_test_endpoints", True)
    org_slug = "e2e_legacy_users"
    schema_name = build_tenant_schema_name(org_slug)
    client = TestClient(app)

    try:
        _reset_test_tenant_schema(org_slug, "E2E Legacy Users")
        _ensure_test_user(org_slug)

        with SessionLocal() as db:
            db.execute(text(f'SET search_path TO "{schema_name}", public'))
            db.execute(text("DROP TABLE IF EXISTS user_roles"))
            db.execute(text("DROP TABLE IF EXISTS users CASCADE"))
            db.execute(
                text(
                    """
                    CREATE TABLE users (
                        id TEXT PRIMARY KEY,
                        email TEXT NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL,
                        full_name TEXT NOT NULL,
                        role TEXT NOT NULL,
                        is_active BOOLEAN NOT NULL DEFAULT TRUE,
                        last_login_at TIMESTAMPTZ NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
            db.commit()

        with SessionLocal() as db:
            user = db.query(User).filter(User.email == "e2e.admin@medhaone.app").one()
            token = create_access_token(str(user.id))

        response = client.get(
            "/masters/warehouses",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        assert isinstance(response.json(), list)
    finally:
        client.close()
        with SessionLocal() as db:
            db.execute(text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE'))
            db.execute(text("DELETE FROM public.organizations WHERE id = :org_slug"), {"org_slug": org_slug})
            db.commit()


def test_party_master_auto_repairs_legacy_party_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.core.tenant.settings.enable_test_endpoints", True)
    org_slug = "e2e_party_master_legacy"
    schema_name = build_tenant_schema_name(org_slug)
    client = TestClient(app)

    try:
        _reset_test_tenant_schema(org_slug, "E2E Party Master Legacy")
        _ensure_test_user(org_slug)

        with SessionLocal() as db:
            db.execute(text(f'SET search_path TO "{schema_name}", public'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS party_code'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS display_name'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS party_category'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS contact_person'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS designation'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS whatsapp_no'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS office_phone'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS website'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS address_line_2'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS country'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS registration_type'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS drug_license_number'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS fssai_number'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS udyam_number'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS credit_limit'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS payment_terms'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS opening_balance'))
            db.execute(text(f'ALTER TABLE "{schema_name}".parties DROP COLUMN IF EXISTS outstanding_tracking_mode'))
            db.execute(
                text(
                    f"""
                    DO $$
                    BEGIN
                      IF NOT EXISTS (
                        SELECT 1 FROM pg_type t
                        JOIN pg_namespace n ON n.oid = t.typnamespace
                        WHERE t.typname = 'party_type_enum' AND n.nspname = '{schema_name}'
                      ) THEN
                        EXECUTE 'CREATE TYPE "{schema_name}".party_type_enum AS ENUM (
                          ''MANUFACTURER'',
                          ''SUPER_STOCKIST'',
                          ''DISTRIBUTOR'',
                          ''HOSPITAL'',
                          ''PHARMACY'',
                          ''RETAILER'',
                          ''CONSUMER''
                        )';
                      END IF;
                    END $$;
                    """
                )
            )
            db.execute(
                text(
                    f"""
                    ALTER TABLE "{schema_name}".parties
                    ALTER COLUMN party_type TYPE "{schema_name}".party_type_enum
                    USING 'SUPER_STOCKIST'::"{schema_name}".party_type_enum
                    """
                )
            )
            db.commit()

        tenant_module._SCHEMA_COMPATIBILITY_CHECKED.discard(schema_name)

        with SessionLocal() as db:
            user = db.query(User).filter(User.email == "e2e.admin@medhaone.app").one()
            token = create_access_token(str(user.id))

        create_response = client.post(
            "/masters/parties",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "party_name": "Legacy Tenant Supplier",
                "party_type": "SUPPLIER",
                "party_category": "DISTRIBUTOR",
                "mobile": "9999999999",
                "gstin": "27ABCDE1234F1Z5",
                "is_active": True,
            },
        )
        assert create_response.status_code == 201, create_response.text
        assert create_response.json()["party_type"] == "SUPPLIER"

        list_response = client.get(
            "/masters/parties",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert list_response.status_code == 200, list_response.text
        assert list_response.json()[0]["party_category"] == "DISTRIBUTOR"
    finally:
        client.close()
        tenant_module._SCHEMA_COMPATIBILITY_CHECKED.discard(schema_name)
        with SessionLocal() as db:
            db.execute(text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE'))
            db.execute(text("DELETE FROM public.organizations WHERE id = :org_slug"), {"org_slug": org_slug})
            db.commit()


def test_purchase_bills_auto_repairs_missing_tables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.core.tenant.settings.enable_test_endpoints", True)
    org_slug = "e2e_purchase_bills_legacy"
    schema_name = build_tenant_schema_name(org_slug)
    client = TestClient(app)

    try:
        _reset_test_tenant_schema(org_slug, "E2E Purchase Bills Legacy")
        _ensure_test_user(org_slug)

        with SessionLocal() as db:
            db.execute(text(f'SET search_path TO "{schema_name}", public'))
            db.execute(text(f'DROP TABLE IF EXISTS "{schema_name}".purchase_bill_lines CASCADE'))
            db.execute(text(f'DROP TABLE IF EXISTS "{schema_name}".purchase_bills CASCADE'))
            db.execute(text(f'DROP TABLE IF EXISTS "{schema_name}".document_attachments CASCADE'))
            db.execute(
                text(
                    f"""
                    DO $$
                    BEGIN
                      IF EXISTS (
                        SELECT 1 FROM pg_type t
                        JOIN pg_namespace n ON n.oid = t.typnamespace
                        WHERE t.typname = 'purchase_bill_status_enum' AND n.nspname = '{schema_name}'
                      ) THEN
                        EXECUTE 'DROP TYPE "{schema_name}".purchase_bill_status_enum';
                      END IF;
                      IF EXISTS (
                        SELECT 1 FROM pg_type t
                        JOIN pg_namespace n ON n.oid = t.typnamespace
                        WHERE t.typname = 'purchase_bill_extraction_status_enum' AND n.nspname = '{schema_name}'
                      ) THEN
                        EXECUTE 'DROP TYPE "{schema_name}".purchase_bill_extraction_status_enum';
                      END IF;
                    END $$;
                    """
                )
            )
            db.commit()

        tenant_module._SCHEMA_COMPATIBILITY_CHECKED.discard(schema_name)

        with SessionLocal() as db:
            user = db.query(User).filter(User.email == "e2e.admin@medhaone.app").one()
            token = create_access_token(str(user.id))

        response = client.get(
            "/purchase-bills",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["items"] == []
    finally:
        client.close()
        tenant_module._SCHEMA_COMPATIBILITY_CHECKED.discard(schema_name)
        with SessionLocal() as db:
            db.execute(text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE'))
            db.execute(text("DELETE FROM public.organizations WHERE id = :org_slug"), {"org_slug": org_slug})
            db.commit()
