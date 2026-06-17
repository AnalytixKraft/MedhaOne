from __future__ import annotations

from types import SimpleNamespace

from app.integrations.gst_verification import setu_client
from app.integrations.gst_verification.parser import parse_result_snapshot
from app.integrations.gst_verification.setu_client import (
    SetuGSTVerificationClient,
    _map_apisetu_response,
)

# Verbatim shape of a real API Setu GSTN v2 response (values trimmed).
_SUCCESS_BODY = {
    "gstIdentificationNumber": "32AFZPL1493E1Z7",
    "legalNameOfBusiness": "Shijo Lawrance",
    "tradeName": "Palamuttem Pharmaceuticals",
    "gstnStatus": "Active",
    "taxpayerType": "Regular",
    "constitutionOfBusiness": "Proprietorship",
    "dateOfRegistration": "11/02/2022",
    "dateOfCancellation": "",
    "stateJurisdiction": "Taxpayer Services Circle, Chengannur",
    "stateJurisdictionCode": "KLC256",
    "centerJurisdiction": "ADOOR RANGE",
    "centerJurisdictionCode": "TH0303",
    "natureOfBusinessActivity": ["Office / Sale Office", "Warehouse / Depot", "Wholesale Business"],
    "eInvoiceStatus": "Yes",
    "lastUpdatedDate": "06/08/2024",
    "principalPlaceOfBusinessFields": {
        "principalPlaceOfBusinessAddress": {
            "buildingName": "PALAMUTTEM",
            "buildingNumber": "915-3",
            "streetName": "Unnamed Road",
            "locality": "POOZHIKKAD",
            "districtName": "Pathanamthitta",
            "stateName": "Kerala",
            "pincode": "689501",
            "floorNumber": "",
        }
    },
}


def test_apisetu_map_success_populates_snapshot_and_parses() -> None:
    step = _map_apisetu_response(
        gstin="32AFZPL1493E1Z7",
        status_code=200,
        body=_SUCCESS_BODY,
        source_url="https://apisetu.gov.in/gstn/v2/taxpayers/32AFZPL1493E1Z7",
    )
    assert step.state == "SUCCESS"
    snap = step.result_snapshot
    assert isinstance(snap, dict)
    assert snap["legal_name"] == "Shijo Lawrance"
    assert snap["trade_name"] == "Palamuttem Pharmaceuticals"
    assert snap["status"] == "Active"
    assert snap["einvoice_status"] == "Yes"
    assert "PALAMUTTEM" in snap["principal_address"]
    assert "KLC256" in snap["state_jurisdiction"]

    # The shared GST parser must accept the mapped snapshot end-to-end.
    parsed = parse_result_snapshot(gstin="32AFZPL1493E1Z7", snapshot=snap)
    assert parsed.legal_name == "Shijo Lawrance"
    assert parsed.trade_name == "Palamuttem Pharmaceuticals"
    assert parsed.status == "Active"
    assert parsed.registration_date is not None
    assert parsed.registration_date.isoformat() == "2022-02-11"  # DD/MM/YYYY parsed
    assert parsed.cancellation_date is None  # "" -> None
    assert parsed.nature_of_business == [
        "Office / Sale Office",
        "Warehouse / Depot",
        "Wholesale Business",
    ]


def test_apisetu_map_not_found_is_failed() -> None:
    step = _map_apisetu_response(
        gstin="32BADGSTIN0Z9",
        status_code=404,
        body={"errorDescription": "GSTIN not found"},
        source_url="https://apisetu.gov.in/gstn/v2/taxpayers/32BADGSTIN0Z9",
    )
    assert step.state == "FAILED"
    assert step.result_snapshot is None
    assert "not found" in (step.remarks or "").lower()


def test_apisetu_map_auth_failure_is_failed() -> None:
    step = _map_apisetu_response(
        gstin="X", status_code=401, body={}, source_url="https://apisetu.gov.in/gstn/v2/taxpayers/X"
    )
    assert step.state == "FAILED"
    assert "authentication" in (step.remarks or "").lower()


def test_apisetu_start_verification_happy_path(monkeypatch) -> None:
    fake_settings = SimpleNamespace(
        setu_gst_base_url="https://apisetu.gov.in",
        setu_client_id="tech.analytixkraft",
        setu_gst_key="apikey-123",
    )
    captured: dict[str, object] = {}

    def _fake_request(*, gstin: str, base_url: str, headers: dict[str, str]):
        captured["gstin"] = gstin
        captured["base_url"] = base_url
        captured["headers"] = headers
        return 200, _SUCCESS_BODY

    monkeypatch.setattr(setu_client, "get_settings", lambda: fake_settings)
    monkeypatch.setattr(setu_client, "_request_taxpayer", _fake_request)

    step = SetuGSTVerificationClient().start_verification(gstin="32afzpl1493e1z7")
    assert step.state == "SUCCESS"
    assert captured["gstin"] == "32AFZPL1493E1Z7"  # normalized upper-case
    assert captured["headers"]["X-APISETU-CLIENTID"] == "tech.analytixkraft"
    assert captured["headers"]["X-APISETU-APIKEY"] == "apikey-123"
    assert captured["headers"]["accept"] == "application/json"


def test_apisetu_start_verification_missing_credentials_fails_cleanly(monkeypatch) -> None:
    fake_settings = SimpleNamespace(
        setu_gst_base_url="https://apisetu.gov.in",
        setu_client_id=None,
        setu_gst_key=None,
    )
    monkeypatch.setattr(setu_client, "get_settings", lambda: fake_settings)

    step = SetuGSTVerificationClient().start_verification(gstin="32AFZPL1493E1Z7")
    assert step.state == "FAILED"
    assert "credentials are not configured" in (step.remarks or "")
