from datetime import datetime, timedelta, timezone

from jose import jwt

from app.core.security import ALGORITHM, create_access_token, decode_access_token, get_settings


def test_local_token_with_local_claims_is_accepted() -> None:
    token = create_access_token("123")

    payload, source = decode_access_token(token)

    assert source == "LOCAL"
    assert payload is not None
    assert payload["sub"] == "123"


def test_local_secret_cannot_sign_rbac_style_claims() -> None:
    settings = get_settings()
    token = jwt.encode(
        {
            "userId": "rbac-user-1",
            "organizationId": "kraft_test",
            "schemaName": "org_kraft_test",
            "role": "ORG_ADMIN",
            "sudoFlag": False,
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        settings.secret_key,
        algorithm=ALGORITHM,
    )

    payload, source = decode_access_token(token)

    assert payload is None
    assert source is None


def test_rbac_secret_cannot_sign_local_style_claims() -> None:
    settings = get_settings()
    token = jwt.encode(
        {
            "sub": "123",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        settings.rbac_jwt_secret,
        algorithm=ALGORITHM,
    )

    payload, source = decode_access_token(token)

    assert payload is None
    assert source is None
