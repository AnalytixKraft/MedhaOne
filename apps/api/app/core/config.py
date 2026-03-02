from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = APP_DIR.parents[1]


class Settings(BaseSettings):
    app_name: str = "MedhaOne API"
    database_url: str = "sqlite:///./medhaone.db"
    secret_key: str = "change-me-in-production"
    rbac_jwt_secret: str | None = None
    rbac_api_url: str = "http://localhost:1740"
    access_token_expire_minutes: int = 120
    cors_origins: list[str] = ["http://localhost:1729"]
    default_admin_email: str = "admin@medhaone.app"
    default_admin_password: str = "ChangeMe123!"
    enable_test_endpoints: bool = False

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


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if not settings.rbac_jwt_secret:
        settings.rbac_jwt_secret = settings.secret_key
    return settings
