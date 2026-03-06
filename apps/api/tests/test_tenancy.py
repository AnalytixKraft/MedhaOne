from __future__ import annotations

from typing import Any

import pytest
from jose import jwt

from app.api.deps import resolve_request_tenant_schema
from app.core.config import get_settings
from app.core.database import reset_search_path, set_tenant_search_path
from app.core.exceptions import AppException
from app.core.tenancy import build_tenant_schema_name, validate_org_slug
from app.core.tenant import (
    ensure_tenant_db_context,
    run_in_tenant_schema,
    validate_tenant_header_or_raise,
)
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
