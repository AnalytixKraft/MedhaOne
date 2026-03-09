from functools import lru_cache
import os
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = APP_DIR.parents[1]


class Settings(BaseSettings):
    app_name: str = "MedhaOne API"
    database_url: str = "postgresql+psycopg://postgres:postgres@127.0.0.1:55432/medhaone_rbac"
    secret_key: str = "change-me-in-production"
    rbac_jwt_secret: str | None = None
    rbac_api_url: str = "http://localhost:1740"
    access_token_expire_minutes: int = 120
    cors_origins: list[str] = ["http://localhost:1729"]
    default_admin_email: str = "admin@medhaone.app"
    default_admin_password: str = "ChangeMe123!"
    enable_test_endpoints: bool = False
    upload_storage_dir: str = str(REPO_ROOT / "storage")

    model_config = SettingsConfigDict(
        env_file=(str(APP_DIR / ".env"), str(REPO_ROOT / ".env")),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        enable_decoding=False,
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("database_url", mode="before")
    @classmethod
    def require_postgres_database(cls, value: str) -> str:
        normalized = value.strip()
        if normalized.startswith("postgresql://"):
            normalized = normalized.replace("postgresql://", "postgresql+psycopg://", 1)

        if not normalized.startswith("postgresql+psycopg://"):
            raise ValueError(
                "DATABASE_URL must point to the shared PostgreSQL tenant database (postgresql+psycopg://...)",
            )

        return normalized

    @field_validator("secret_key")
    @classmethod
    def require_non_placeholder_secret_key(cls, value: str) -> str:
        normalized = value.strip()
        if normalized == "change-me-in-production" and "PYTEST_CURRENT_TEST" not in os.environ:
            raise ValueError("SECRET_KEY must be set to a non-placeholder value")
        return normalized

    @field_validator("default_admin_password")
    @classmethod
    def require_non_placeholder_admin_password(cls, value: str) -> str:
        normalized = value.strip()
        if normalized == "ChangeMe123!" and "PYTEST_CURRENT_TEST" not in os.environ:
            raise ValueError("DEFAULT_ADMIN_PASSWORD must be set to a non-placeholder value")
        return normalized


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if not settings.rbac_jwt_secret:
        settings.rbac_jwt_secret = settings.secret_key
    return settings
