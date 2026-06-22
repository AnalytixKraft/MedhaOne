from __future__ import annotations

from collections.abc import Iterable

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.integrations.drug_license_verification.client import (
    VerificationClientStep,
    get_drug_license_verification_client,
    set_drug_license_verification_client,
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


def _create_party(db: Session, *, name: str, gstin: str, drug_license_number: str | None = None) -> Party:
    party = Party(
        name=name,
        party_type="SUPPLIER",
        party_category="DISTRIBUTOR",
        gstin=gstin,
        state="Maharashtra",
        city="Pune",
        country="India",
        drug_license_number=drug_license_number,
        is_active=True,
    )
    db.add(party)
    db.commit()
    db.refresh(party)
    return party


class _CaptchaThenSuccessClient:
    def start_verification(self, *, license_number: str) -> VerificationClientStep:
        return VerificationClientStep(
            state="CAPTCHA_REQUIRED",
            source_url="https://verify.example.gov",
            remarks="Enter the captcha from the source portal.",
            session_context={"session_id": "abc123", "license_number": license_number},
            challenge_text="Captcha shown on the government portal.",
        )

    def resume_verification(
        self,
        *,
        license_number: str,
        captcha_value: str,
        session_context: dict | None,
    ) -> VerificationClientStep:
        assert captcha_value == "654321"
        assert session_context == {"session_id": "abc123", "license_number": license_number}
        return VerificationClientStep(
            state="SUCCESS",
            source_url="https://verify.example.gov",
            result_snapshot={
                "license_number": license_number,
                "holder_name": "Acme Pharma Distributors",
                "status": "ACTIVE",
                "valid_upto": "2027-12-31",
                "authority": "State Drug Control",
                "state": "Maharashtra",
            },
        )


class _FailureClient:
    def start_verification(self, *, license_number: str) -> VerificationClientStep:
        return VerificationClientStep(
            state="FAILED",
            source_url="https://verify.example.gov",
            remarks=f"Licence {license_number} was not found.",
        )

    def resume_verification(
        self,
        *,
        license_number: str,
        captcha_value: str,
        session_context: dict | None,
    ) -> VerificationClientStep:
        raise AssertionError("resume_verification should not be called for the failure client")


class _SuccessButNoRecordClient:
    """Portal replies HTTP 200 but with a 'no record found' page (empty parse)."""

    def start_verification(self, *, license_number: str) -> VerificationClientStep:
        return VerificationClientStep(
            state="CAPTCHA_REQUIRED",
            source_url="https://verify.example.gov",
            session_context={"session_id": "abc123", "license_number": license_number},
            challenge_text="Captcha shown on the government portal.",
        )

    def resume_verification(
        self,
        *,
        license_number: str,
        captcha_value: str,
        session_context: dict | None,
    ) -> VerificationClientStep:
        return VerificationClientStep(
            state="SUCCESS",
            source_url="https://verify.example.gov",
            result_snapshot="<html><body>No record found for this licence.</body></html>",
        )


class _StartNoRecordClient:
    """Auto-completes on start but the portal returns a 'no record found' page."""

    def start_verification(self, *, license_number: str) -> VerificationClientStep:
        return VerificationClientStep(
            state="SUCCESS",
            source_url="https://verify.example.gov",
            result_snapshot="<html><body>No record found for this licence.</body></html>",
        )

    def resume_verification(
        self,
        *,
        license_number: str,
        captcha_value: str,
        session_context: dict | None,
    ) -> VerificationClientStep:
        raise AssertionError("resume_verification should not be called")


def test_drug_license_verification_prefills_party_licence_and_enters_captcha_required_state(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    party = _create_party(
        db,
        name="Acme Distributors",
        gstin="27ABCDE1234F1Z5",
        drug_license_number="DL-ACME-001",
    )
    headers = _create_access_user(
        db,
        email="drug-license-admin@medhaone.app",
        permission_codes={"drug_license:verify", "party:view"},
    )
    original_client = get_drug_license_verification_client()
    set_drug_license_verification_client(_CaptchaThenSuccessClient())

    try:
        response = client.post(
            "/masters/drug-license-verification/start",
            headers=headers,
            json={"party_id": party.id},
        )
    finally:
        set_drug_license_verification_client(original_client)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["log"]["drug_license_number"] == "DL-ACME-001"
    assert body["log"]["status"] == "CAPTCHA_REQUIRED"
    assert body["can_resume"] is True
    assert body["challenge_text"] == "Captcha shown on the government portal."


def test_drug_license_verification_without_party_returns_session(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    """A licence number can be verified without linking a party (party_id is optional)."""
    client, db = client_with_test_db
    headers = _create_access_user(
        db,
        email="drug-license-standalone@medhaone.app",
        permission_codes={"drug_license:verify"},
    )
    original_client = get_drug_license_verification_client()
    set_drug_license_verification_client(_CaptchaThenSuccessClient())

    try:
        response = client.post(
            "/masters/drug-license-verification/start",
            headers=headers,
            json={"drug_license_number": "WLF20B2023KL002201"},
        )
    finally:
        set_drug_license_verification_client(original_client)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["log"]["party_id"] is None
    assert body["log"]["party_name"] is None
    assert body["log"]["drug_license_number"] == "WLF20B2023KL002201"
    assert body["log"]["status"] == "CAPTCHA_REQUIRED"
    assert body["can_resume"] is True


def test_successful_verification_resume_and_save_updates_party(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    party = _create_party(
        db,
        name="Zenith Pharma",
        gstin="27ABCDE1234F1Z6",
        drug_license_number="DL-ZEN-001",
    )
    headers = _create_access_user(
        db,
        email="drug-license-save@medhaone.app",
        permission_codes={
            "drug_license:verify",
            "drug_license:save_verified_data",
            "drug_license:history_view",
            "party:view",
        },
    )
    original_client = get_drug_license_verification_client()
    set_drug_license_verification_client(_CaptchaThenSuccessClient())

    try:
        start_response = client.post(
            "/masters/drug-license-verification/start",
            headers=headers,
            json={"party_id": party.id},
        )
        assert start_response.status_code == 200, start_response.text
        log_id = start_response.json()["log"]["id"]

        resume_response = client.post(
            f"/masters/drug-license-verification/{log_id}/resume",
            headers=headers,
            json={"captcha_value": "654321"},
        )
        assert resume_response.status_code == 200, resume_response.text
        resume_body = resume_response.json()
        assert resume_body["log"]["status"] == "SUCCESS"
        assert resume_body["result"]["holder_name"] == "Acme Pharma Distributors"

        save_response = client.post(
            f"/masters/drug-license-verification/{log_id}/save",
            headers=headers,
            json={"remarks": "Verified during onboarding"},
        )
    finally:
        set_drug_license_verification_client(original_client)

    assert save_response.status_code == 200, save_response.text
    save_body = save_response.json()
    assert save_body["drug_license_verified_status"] == "VERIFIED"
    assert save_body["drug_license_holder_name"] == "Acme Pharma Distributors"
    assert save_body["drug_license_verification_source"] == "https://verify.example.gov"
    assert save_body["drug_license_valid_upto"] == "2027-12-31"

    history_response = client.get(
        "/masters/drug-license-verification/history",
        headers=headers,
        params={"party_id": party.id},
    )
    assert history_response.status_code == 200, history_response.text
    assert history_response.json()["items"][0]["status"] == "SUCCESS"


def test_no_record_response_is_not_treated_as_verified(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    """A portal 200 with no matching licence must report FAILED, never VERIFIED."""
    client, db = client_with_test_db
    party = _create_party(
        db,
        name="Ghost Pharma",
        gstin="27ABCDE1234F1Z2",
        drug_license_number="KL/PAL/MD42/2026/00001",
    )
    headers = _create_access_user(
        db,
        email="drug-license-nomatch@medhaone.app",
        permission_codes={
            "drug_license:verify",
            "drug_license:save_verified_data",
            "party:view",
        },
    )
    original_client = get_drug_license_verification_client()
    set_drug_license_verification_client(_SuccessButNoRecordClient())

    try:
        start_response = client.post(
            "/masters/drug-license-verification/start",
            headers=headers,
            json={"party_id": party.id},
        )
        assert start_response.status_code == 200, start_response.text
        log_id = start_response.json()["log"]["id"]

        resume_response = client.post(
            f"/masters/drug-license-verification/{log_id}/resume",
            headers=headers,
            json={"captcha_value": "654321"},
        )
        assert resume_response.status_code == 200, resume_response.text
        resume_body = resume_response.json()
        # Portal returned 200 but no licence details → must NOT be verified.
        assert resume_body["log"]["status"] == "FAILED"
        assert resume_body["result"] is None

        # Saving must be rejected — there is no verified result to persist.
        save_response = client.post(
            f"/masters/drug-license-verification/{log_id}/save",
            headers=headers,
            json={},
        )
        assert save_response.status_code == 400, save_response.text
    finally:
        set_drug_license_verification_client(original_client)

    db.refresh(party)
    assert party.drug_license_verified_status == "NOT_VERIFIED"


def test_no_match_clears_existing_party_verified_status(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    """A confirmed no-match must downgrade a party's previously-verified licence."""
    client, db = client_with_test_db
    party = _create_party(
        db,
        name="Stale Verified Pharma",
        gstin="27ABCDE1234F1Z3",
        drug_license_number="KL/PAL/MD42/2026/00001",
    )
    # Simulate a licence that was marked verified earlier.
    party.drug_license_verified_status = "VERIFIED"
    party.drug_license_holder_name = "Old Holder"
    db.commit()

    headers = _create_access_user(
        db,
        email="drug-license-clear@medhaone.app",
        permission_codes={"drug_license:verify", "party:view"},
    )
    original_client = get_drug_license_verification_client()
    set_drug_license_verification_client(_StartNoRecordClient())

    try:
        response = client.post(
            "/masters/drug-license-verification/start",
            headers=headers,
            json={"party_id": party.id},
        )
    finally:
        set_drug_license_verification_client(original_client)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["log"]["status"] == "FAILED"
    assert body["result"] is None

    db.refresh(party)
    assert party.drug_license_verified_status == "FAILED"
    assert party.drug_license_holder_name is None


def test_failed_verification_is_logged_for_traceability(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    party = _create_party(
        db,
        name="Southern Surgical",
        gstin="27ABCDE1234F1Z7",
        drug_license_number="DL-SOUTH-001",
    )
    headers = _create_access_user(
        db,
        email="drug-license-failed@medhaone.app",
        permission_codes={"drug_license:verify", "drug_license:history_view", "party:view"},
    )
    original_client = get_drug_license_verification_client()
    set_drug_license_verification_client(_FailureClient())

    try:
        response = client.post(
            "/masters/drug-license-verification/start",
            headers=headers,
            json={"party_id": party.id},
        )
    finally:
        set_drug_license_verification_client(original_client)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["log"]["status"] == "FAILED"
    assert body["result"] is None

    history_response = client.get(
        "/masters/drug-license-verification/history",
        headers=headers,
        params={"party_id": party.id, "status": "FAILED"},
    )
    assert history_response.status_code == 200, history_response.text
    history_body = history_response.json()
    assert len(history_body["items"]) == 1
    assert history_body["items"][0]["remarks"] == "Licence DL-SOUTH-001 was not found."


def test_verification_history_detail_returns_saved_log(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    party = _create_party(
        db,
        name="CityCare Hospital",
        gstin="27ABCDE1234F1Z8",
        drug_license_number="DL-CITY-001",
    )
    headers = _create_access_user(
        db,
        email="drug-license-history@medhaone.app",
        permission_codes={"drug_license:verify", "drug_license:history_view", "party:view"},
    )
    original_client = get_drug_license_verification_client()
    set_drug_license_verification_client(_FailureClient())

    try:
        start_response = client.post(
            "/masters/drug-license-verification/start",
            headers=headers,
            json={"party_id": party.id},
        )
    finally:
        set_drug_license_verification_client(original_client)

    log_id = start_response.json()["log"]["id"]
    detail_response = client.get(
        f"/masters/drug-license-verification/history/{log_id}",
        headers=headers,
    )
    assert detail_response.status_code == 200, detail_response.text
    detail = detail_response.json()
    assert detail["id"] == log_id
    assert detail["party_id"] == party.id
    assert detail["status"] == "FAILED"


def test_drug_license_verification_requires_permission(
    client_with_test_db: tuple[TestClient, Session],
) -> None:
    client, db = client_with_test_db
    party = _create_party(
        db,
        name="No Access Pharma",
        gstin="27ABCDE1234F1Z9",
        drug_license_number="DL-NO-ACCESS",
    )
    headers = _create_access_user(
        db,
        email="no-access@medhaone.app",
        permission_codes={"party:view"},
    )

    response = client.post(
        "/masters/drug-license-verification/start",
        headers=headers,
        json={"party_id": party.id},
    )

    assert response.status_code == 403, response.text


def test_parse_result_snapshot_maps_ondls_portal_fields() -> None:
    from app.integrations.drug_license_verification.parser import parse_result_snapshot

    parsed = parse_result_snapshot(
        license_number="WLF21B2023KL002174",
        snapshot={
            "institute_name": "MURUKAN & CO",
            "licence_status": "Active",
            "str_ondls_licence_no": "WLF21B2023KL002174",
            "dt_curr_validity_date": "03-Nov-2028",
        },
    )
    assert parsed.holder_name == "MURUKAN & CO"
    assert parsed.status == "Active"
    assert parsed.license_number == "WLF21B2023KL002174"
    assert parsed.valid_upto is not None
    assert parsed.valid_upto.isoformat() == "2028-11-03"
