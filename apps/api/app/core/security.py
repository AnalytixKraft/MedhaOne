from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
settings = get_settings()

ALGORITHM = "HS256"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    to_encode: dict[str, Any] = {"sub": subject, "exp": expire}
    return jwt.encode(to_encode, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> tuple[dict[str, Any] | None, str | None]:
    secrets_to_try = [("LOCAL", settings.secret_key)]
    if settings.rbac_jwt_secret and settings.rbac_jwt_secret != settings.secret_key:
        secrets_to_try.append(("RBAC", settings.rbac_jwt_secret))

    for source, secret in secrets_to_try:
        try:
            return jwt.decode(token, secret, algorithms=[ALGORITHM]), source
        except JWTError:
            continue

    return None, None
