from __future__ import annotations

from typing import Any

import pytest

from app.api.deps import resolve_request_tenant_schema
from app.core.database import reset_search_path, set_tenant_search_path
from app.core.exceptions import AppException
from app.core.tenancy import build_tenant_schema_name, validate_org_slug
from app.services import tenancy as tenancy_service


class _FakeResult:
    def __init__(self, row: dict[str, Any] | None):
        self._row = row

    def mappings(self) -> "_FakeResult":
        return self

    def first(self) -> dict[str, Any] | None:
        return self._row


class _FakeSession:
    def __init__(self, row: dict[str, Any] | None = None):
        self.row = row
        self.statements: list[tuple[str, dict[str, Any] | None]] = []
        self.info: dict[str, Any] = {}
        self.committed = False

    def execute(self, statement, params: dict[str, Any] | None = None):
        sql = str(statement)
        self.statements.append((sql, params))
        if "SELECT id, schema_name, is_active" in sql:
            return _FakeResult(self.row)
        return _FakeResult(None)

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        return None


def test_validate_org_slug_rejects_invalid_values() -> None:
    with pytest.raises(AppException) as caught:
        validate_org_slug("alpha-beta")

    assert caught.value.error_code == "INVALID_ORG"


def test_resolve_request_tenant_schema_uses_token_context_and_public_org_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.api.deps.IS_POSTGRES", True)
    session = _FakeSession(
        {
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
    monkeypatch.setattr("app.api.deps.IS_POSTGRES", True)
    session = _FakeSession(
        {
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
    monkeypatch.setattr("app.api.deps.IS_POSTGRES", True)

    first = resolve_request_tenant_schema(
        payload={"organizationId": "alpha", "schemaName": "org_alpha"},
        db=_FakeSession({"id": "alpha", "schema_name": "org_alpha", "is_active": True}),
    )
    second = resolve_request_tenant_schema(
        payload={"organizationId": "beta", "schemaName": "org_beta"},
        db=_FakeSession({"id": "beta", "schema_name": "org_beta", "is_active": True}),
    )

    assert first == "org_alpha"
    assert second == "org_beta"
    assert first != second


def test_search_path_is_applied_and_reset_per_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.core.database.IS_POSTGRES", True)
    session = _FakeSession()

    set_tenant_search_path(session, "org_alpha")
    reset_search_path(session)

    assert 'SET search_path TO "org_alpha", public' in session.statements[0][0]
    assert "SET search_path TO public" in session.statements[1][0]
    assert "tenant_schema" not in session.info


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

    def _fake_run(schema_name: str) -> None:
        called["schema"] = schema_name

    monkeypatch.setattr("app.services.tenancy.run_tenant_schema_migrations", _fake_run)

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
