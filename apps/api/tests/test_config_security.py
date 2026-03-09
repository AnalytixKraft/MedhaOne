import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_placeholder_secret_key_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)

    with pytest.raises(ValidationError, match="SECRET_KEY must be set to a non-placeholder value"):
        Settings(
            database_url="postgresql+psycopg://postgres:postgres@127.0.0.1:55432/medhaone_rbac",
            secret_key="change-me-in-production",
            default_admin_password="StrongAdminPassword_2026!",
        )


def test_placeholder_default_admin_password_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)

    with pytest.raises(ValidationError, match="DEFAULT_ADMIN_PASSWORD must be set to a non-placeholder value"):
        Settings(
            database_url="postgresql+psycopg://postgres:postgres@127.0.0.1:55432/medhaone_rbac",
            secret_key="medhaone_test_secret_2026",
            default_admin_password="ChangeMe123!",
        )
