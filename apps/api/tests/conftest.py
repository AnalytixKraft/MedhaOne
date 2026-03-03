from collections.abc import Generator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.database import get_db as core_get_db
from app.core.database import get_public_db
from app.core.tenant import ensure_tenant_db_context, resolve_request_tenant_schema
from app.main import app
from app.models.base import Base

TEST_TENANT_SLUG = "pytest_tenant"
TEST_TENANT_NAME = "Pytest Tenant"
TEST_TENANT_SCHEMA = "org_pytest_tenant"


def _build_test_engine():
    settings = get_settings()
    return create_engine(settings.database_url, pool_pre_ping=True)


def _bootstrap_test_schema(engine) -> None:
    with engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{TEST_TENANT_SCHEMA}"'))
        connection.execute(
            text(
                """
                INSERT INTO public.organizations (
                    id,
                    name,
                    schema_name,
                    max_users,
                    is_active
                )
                VALUES (:org_id, :name, :schema_name, 100, TRUE)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    schema_name = EXCLUDED.schema_name,
                    max_users = EXCLUDED.max_users,
                    is_active = TRUE,
                    updated_at = NOW()
                """
            ),
            {
                "org_id": TEST_TENANT_SLUG,
                "name": TEST_TENANT_NAME,
                "schema_name": TEST_TENANT_SCHEMA,
            },
        )


def _teardown_test_schema(engine) -> None:
    with engine.begin() as connection:
        connection.execute(text(f'DROP SCHEMA IF EXISTS "{TEST_TENANT_SCHEMA}" CASCADE'))
        connection.execute(
            text("DELETE FROM public.organizations WHERE id = :org_id"),
            {"org_id": TEST_TENANT_SLUG},
        )


@contextmanager
def _isolated_test_db() -> Generator[tuple[Session, object], None, None]:
    engine = _build_test_engine()
    _bootstrap_test_schema(engine)
    connection = engine.connect()
    connection.execute(text(f'SET search_path TO "{TEST_TENANT_SCHEMA}", public'))
    translated_connection = connection.execution_options(
        schema_translate_map={None: TEST_TENANT_SCHEMA},
    )
    Base.metadata.create_all(bind=translated_connection)
    connection.commit()
    testing_session_local = sessionmaker(
        bind=translated_connection,
        autocommit=False,
        autoflush=False,
    )
    session = testing_session_local()

    try:
        yield session, engine
    finally:
        session.close()
        connection.close()
        _teardown_test_schema(engine)
        engine.dispose()


@pytest.fixture()
def db_session() -> Generator[Session, None, None]:
    with _isolated_test_db() as (session, _engine):
        yield session


@pytest.fixture()
def client_with_test_db() -> Generator[tuple[TestClient, Session], None, None]:
    with _isolated_test_db() as (session, _engine):
        def _override_get_db() -> Generator[Session, None, None]:
            yield session

        app.dependency_overrides[core_get_db] = _override_get_db
        app.dependency_overrides[get_public_db] = _override_get_db
        app.dependency_overrides[resolve_request_tenant_schema] = lambda: TEST_TENANT_SCHEMA
        app.dependency_overrides[ensure_tenant_db_context] = lambda: None
        client = TestClient(app)
        try:
            yield client, session
        finally:
            app.dependency_overrides.clear()
            client.close()
