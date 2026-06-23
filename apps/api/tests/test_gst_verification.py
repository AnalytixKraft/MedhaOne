from __future__ import annotations

from collections.abc import Iterable

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.integrations.gst_verification.client import (
    GSTVerificationClientStep,
    get_gst_verification_client,
    set_gst_verification_client,
)
from app.models.party import Party
from app.models.rbac import Permission, RolePermission
from app.models.role import Role
from app.models.user import User
from app.services.rbac import ensure_rbac_seeded


def _create_access_user(
    db: Session,
    *,
    email: str,
    permission_codes: Iterable[str] = (),
    is_superuser: bool = False,
) -> dict[str, str]:
    ensure_rbac_seeded(db)
    role = Role(name=email.replace("@", "-"), is_active=True)
    db.add(role)
    db.flush()

    for permission_code in permission_codes:
        permission = db.query(Permission).filter(Permission.code == permission_code).one()
        role.role_permissions.append(RolePermission(permission_id=permission.id))

    user = User(
        email=email,
        full_name=email.split("@")[0],
        hashed_password="not-used",
        is_active=True,
        is_superuser=is_superuser,
        role_id=role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}


def _create_party(db: Session, *, name: str, gstin: str) -> Party:
    party = Party(
        name=name,
        party_type="SUPPLIER",
        party_category="DISTRIBUTOR",
        gstin=gstin,
        state="Maharashtra",
        city="Pune",
        country="India",
        is_active=True,
    )
    db.add(party)
    db.commit()
    db.refresh(party)
    return party


class _SuccessfulGSTClient:
    def start_verification(self, *, gstin: str) -> GSTVerificationClientStep:
        return GSTVerificationClientStep(
            state="SUCCESS",
            source_url="https://services.gst.gov.in/services/searchtp",
            result_snapshot={
                "gstin": gstin,
                "lgnm": "Zenith Pharma Distributors",
                "tradeNam": "Zenith Pharma",
                "sts": "Active",
                "rgdt": "01/04/2022",
                "ctb": "Partnership",
                "pradr": {"adr": "Pune, Maharashtra"},
                "nba": ["Wholesale Business"],
            },
        )

    def resume_verification(
        self,
        *,
        gstin: str,
        captcha_value: str,
        session_context: dict | None,
    ) -> GSTVerificationClientStep:
        raise AssertionError("resume_verification should not be called")


class _RejectedHTMLGSTClient:
    def start_verification(self, *, gstin: str) -> GSTVerificationClientStep:
        _ = gstin
        return GSTVerificationClientStep(
            state="SUCCESS",
            source_url="https://services.gst.gov.in/services/searchtp",
            result_snapshot=(
                "<html><head><title>Request Rejected</title></head>"
                "<body>The requested URL was rejected.</body></html>"
            ),
        )

    def resume_verification(
        self,
        *,
        gstin: str,
        captcha_value: str,
        session_context: dict | None,
    ) -> GSTVerificationClientStep:
        raise AssertionError("resume_verification should not be called")


def test_gst_verification_success_keeps_structured_raw_snapshot(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    party = _create_party(db, name="Zenith Pharma", gstin="27ABCDE1234F1Z5")
    headers = _create_access_user(
        db,
        email="gst-verify@medhaone.app",
        permission_codes={"gst:verify"},
    )
    original_client = get_gst_verification_client()
    set_gst_verification_client(_SuccessfulGSTClient())

    try:
        response = client.post(
            "/masters/gst-verification/start",
            headers=headers,
            json={"party_id": party.id},
        )
    finally:
        set_gst_verification_client(original_client)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["log"]["status"] == "SUCCESS"
    assert body["result"]["legal_name"] == "Zenith Pharma Distributors"
    assert body["result"]["raw_snapshot"]["lgnm"] == "Zenith Pharma Distributors"
    assert body["log"]["response_snapshot"] is not None


def test_gst_verification_rejected_html_is_parse_failed_and_preserves_full_response(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    party = _create_party(db, name="Acme GST", gstin="27ABCDE1234F1Z6")
    headers = _create_access_user(
        db,
        email="gst-parse@medhaone.app",
        permission_codes={"gst:verify", "gst:history_view"},
    )
    original_client = get_gst_verification_client()
    set_gst_verification_client(_RejectedHTMLGSTClient())

    try:
        response = client.post(
            "/masters/gst-verification/start",
            headers=headers,
            json={"party_id": party.id},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        log_id = body["log"]["id"]

        detail_response = client.get(
            f"/masters/gst-verification/history/{log_id}",
            headers=headers,
        )
    finally:
        set_gst_verification_client(original_client)

    assert body["log"]["status"] == "PARSE_FAILED"
    assert body["result"] is None
    assert "Request Rejected" in body["log"]["response_snapshot"]
    assert body["log"]["extracted_data_json"]["parse_failure_reason"]

    assert detail_response.status_code == 200, detail_response.text
    detail = detail_response.json()
    assert detail["status"] == "PARSE_FAILED"
    assert "Request Rejected" in detail["response_snapshot"]
