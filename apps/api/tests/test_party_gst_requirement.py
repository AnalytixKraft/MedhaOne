from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.integrations.gst_verification.client import (
    GSTVerificationClientStep,
    get_gst_verification_client,
    set_gst_verification_client,
)
from app.models.role import Role
from app.models.user import User
from app.services.rbac import ensure_rbac_seeded

_GSTIN = "27AAICB3918J1CT"


def _superuser_headers(db: Session) -> dict[str, str]:
    ensure_rbac_seeded(db)
    role = Role(name="party-gst-test", is_active=True)
    db.add(role)
    db.flush()
    user = User(
        email="party-gst-admin@medhaone.app",
        full_name="Party GST Admin",
        hashed_password="not-used",
        is_active=True,
        is_superuser=True,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


class _SuccessGstClient:
    def start_verification(self, *, gstin: str) -> GSTVerificationClientStep:
        return GSTVerificationClientStep(
            state="SUCCESS",
            source_url=f"https://apisetu.gov.in/gstn/v2/taxpayers/{gstin}",
            result_snapshot={
                "gstin": gstin,
                "legal_name": "Verified Distributors Pvt Ltd",
                "trade_name": "Verified Distributors",
                "status": "Active",
                "registration_date": "11/02/2022",
            },
        )

    def resume_verification(self, *, gstin, captcha_value, session_context):  # noqa: ANN001
        return self.start_verification(gstin=gstin)


def test_retailer_can_be_created_without_gstin(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers = _superuser_headers(db)
    resp = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Corner Medical Store",
            "party_type": "CUSTOMER",
            "party_category": "RETAILER",
            "state": "Kerala",
            "city": "Kochi",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["gstin"] is None
    assert body["gst_verified_status"] == "NOT_VERIFIED"


def test_non_retailer_without_verification_is_rejected(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers = _superuser_headers(db)
    resp = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Acme Distributors",
            "party_type": "SUPPLIER",
            "party_category": "DISTRIBUTOR",
            "gstin": _GSTIN,
            "state": "Maharashtra",
        },
    )
    assert resp.status_code == 400, resp.text
    assert "GST verification" in resp.json()["message"]


def test_non_retailer_with_verified_log_is_created_verified(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers = _superuser_headers(db)

    original = get_gst_verification_client()
    set_gst_verification_client(_SuccessGstClient())
    try:
        start = client.post(
            "/masters/gst-verification/start",
            headers=headers,
            json={"gstin": _GSTIN},
        )
        assert start.status_code == 200, start.text
        log_id = start.json()["log"]["id"]
    finally:
        set_gst_verification_client(original)

    resp = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Acme Distributors",
            "party_type": "SUPPLIER",
            "party_category": "DISTRIBUTOR",
            "gstin": _GSTIN,
            "state": "Maharashtra",
            "gst_verification_log_id": log_id,
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["gst_verified_status"] == "VERIFIED"
    assert body["gst_legal_name"] == "Verified Distributors Pvt Ltd"


def test_category_not_linked_to_party_type_is_rejected(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    headers = _superuser_headers(db)
    # RETAILER is seeded linked to CUSTOMER only — a SUPPLIER party can't use it.
    resp = client.post(
        "/masters/parties",
        headers=headers,
        json={
            "party_name": "Mismatched Supplier",
            "party_type": "SUPPLIER",
            "party_category": "RETAILER",
            "gstin": _GSTIN,
            "state": "Maharashtra",
        },
    )
    assert resp.status_code == 400, resp.text
    assert "not linked to party type" in resp.json()["message"]
