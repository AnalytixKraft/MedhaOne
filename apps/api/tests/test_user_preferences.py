from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token, get_password_hash
from app.models.user import User


def _create_user(db: Session, *, email: str) -> User:
    user = User(
        email=email,
        full_name="Theme User",
        hashed_password=get_password_hash("ChangeMe123!"),
        organization_slug="pytest_tenant",
        is_active=True,
        is_superuser=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _headers_for(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


def test_user_preferences_default_to_system(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    user = _create_user(db, email="theme-default@medhaone.app")

    response = client.get("/users/me/preferences", headers=_headers_for(user))

    assert response.status_code == 200, response.text
    assert response.json() == {"theme_preference": "system"}


def test_user_can_update_own_theme_preference(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    user = _create_user(db, email="theme-update@medhaone.app")

    response = client.patch(
        "/users/me/preferences",
        headers=_headers_for(user),
        json={"theme_preference": "dark"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"theme_preference": "dark"}

    db.refresh(user)
    assert user.theme_preference == "dark"


def test_user_preference_update_is_user_scoped(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    user_a = _create_user(db, email="theme-a@medhaone.app")
    user_b = _create_user(db, email="theme-b@medhaone.app")

    update_response = client.patch(
        "/users/me/preferences",
        headers=_headers_for(user_a),
        json={"theme_preference": "light"},
    )
    assert update_response.status_code == 200, update_response.text

    user_b_response = client.get("/users/me/preferences", headers=_headers_for(user_b))
    assert user_b_response.status_code == 200, user_b_response.text
    assert user_b_response.json() == {"theme_preference": "system"}
