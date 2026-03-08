from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import create_access_token, get_password_hash
from app.models.user import User
from app.services.rbac import assign_roles_to_user, ensure_rbac_seeded
from conftest import TEST_TENANT_SLUG


def _create_user(
    db: Session,
    *,
    email: str,
    role_names: list[str],
    password: str = "ChangeMe123!",
    organization_slug: str | None = TEST_TENANT_SLUG,
) -> User:
    roles_by_name = ensure_rbac_seeded(db)
    role_ids = [roles_by_name[name].id for name in role_names]
    user = User(
        email=email,
        full_name=email.split("@")[0].replace(".", " ").title(),
        hashed_password=get_password_hash(password),
        is_active=True,
        is_superuser=False,
        organization_slug=organization_slug,
        role_id=role_ids[0] if role_ids else None,
    )
    db.add(user)
    db.flush()
    assign_roles_to_user(db, user, role_ids)
    db.commit()
    db.refresh(user)
    return user


def _headers_for(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


def _reset_public_global_defaults(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS public.global_tax_rates (
              id SERIAL PRIMARY KEY,
              code VARCHAR(40) NOT NULL UNIQUE,
              label VARCHAR(120) NOT NULL,
              rate_percent NUMERIC(5, 2) NOT NULL,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
    )
    db.execute(text("DELETE FROM public.global_tax_rates"))
    db.execute(
        text(
            """
            INSERT INTO public.global_tax_rates (code, label, rate_percent, is_active)
            VALUES
              ('GST_0', 'GST 0%', 0.00, TRUE),
              ('GST_5', 'GST 5%', 5.00, TRUE),
              ('GST_12', 'GST 12%', 12.00, TRUE),
              ('GST_28', 'GST 28%', 28.00, TRUE)
            """
        )
    )
    db.commit()


def test_tenant_tax_rates_seed_default_slabs(client_with_test_db: tuple[TestClient, Session]) -> None:
    client, db = client_with_test_db
    user = _create_user(db, email="tax-seed@medhaone.app", role_names=["ORG_ADMIN"])
    headers = _headers_for(user)

    response = client.get("/tax-rates", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    codes = {row["code"] for row in payload}

    assert {"GST_0", "GST_5", "GST_12", "GST_28"}.issubset(codes)


def test_tenant_custom_tax_does_not_mutate_global_defaults(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    _reset_public_global_defaults(db)
    user = _create_user(db, email="tax-isolation@medhaone.app", role_names=["ORG_ADMIN"])
    headers = _headers_for(user)

    create_response = client.post(
        "/tax-rates",
        headers=headers,
        json={
            "code": "GST_10",
            "label": "GST 10%",
            "rate_percent": 10,
            "is_active": True,
        },
    )
    assert create_response.status_code == 201, create_response.text

    global_rows = db.execute(
        text(
            """
            SELECT code, rate_percent::text
            FROM public.global_tax_rates
            ORDER BY code
            """
        )
    ).mappings().all()

    assert {row["code"] for row in global_rows} == {"GST_0", "GST_5", "GST_12", "GST_28"}


def test_tax_rate_endpoint_returns_tenant_custom_slabs_for_purchase_dropdown(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    user = _create_user(db, email="tax-dropdown@medhaone.app", role_names=["ORG_ADMIN"])
    headers = _headers_for(user)

    create_response = client.post(
        "/tax-rates",
        headers=headers,
        json={
            "code": "GST_10",
            "label": "GST 10%",
            "rate_percent": 10,
            "is_active": True,
        },
    )
    assert create_response.status_code == 201, create_response.text
    created_id = create_response.json()["id"]

    visible_response = client.get("/tax-rates", headers=headers)
    assert visible_response.status_code == 200, visible_response.text
    visible_codes = {row["code"] for row in visible_response.json()}
    assert "GST_10" in visible_codes

    deactivate_response = client.patch(
        f"/tax-rates/{created_id}",
        headers=headers,
        json={"is_active": False},
    )
    assert deactivate_response.status_code == 200, deactivate_response.text

    active_only_response = client.get("/tax-rates", headers=headers)
    assert active_only_response.status_code == 200, active_only_response.text
    assert "GST_10" not in {row["code"] for row in active_only_response.json()}

    include_inactive_response = client.get("/tax-rates?include_inactive=true", headers=headers)
    assert include_inactive_response.status_code == 200, include_inactive_response.text
    assert "GST_10" in {row["code"] for row in include_inactive_response.json()}


def test_tax_rate_update_survives_audit_write_failure(
    client_with_test_db: tuple[TestClient, Session],
    monkeypatch,
) -> None:
    client, db = client_with_test_db
    user = _create_user(db, email="tax-audit-failure@medhaone.app", role_names=["ORG_ADMIN"])
    headers = _headers_for(user)

    create_response = client.post(
        "/tax-rates",
        headers=headers,
        json={
            "code": "GST_11",
            "label": "GST 11%",
            "rate_percent": 11,
            "is_active": True,
        },
    )
    assert create_response.status_code == 201, create_response.text
    tax_rate_id = create_response.json()["id"]

    def _raise_audit_failure(*_args, **_kwargs):
        raise RuntimeError("audit insert failed")

    monkeypatch.setattr("app.api.routes.tax_rates.write_audit_log", _raise_audit_failure)

    deactivate_response = client.patch(
        f"/tax-rates/{tax_rate_id}",
        headers=headers,
        json={"is_active": False},
    )
    assert deactivate_response.status_code == 200, deactivate_response.text
    assert deactivate_response.json()["is_active"] is False
