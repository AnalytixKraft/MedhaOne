"""
API Setu GST Verification Client
================================
Verifies a GSTIN against the Government of India's API Setu platform
(``GET https://apisetu.gov.in/gstn/v2/taxpayers/{gstin}``) instead of scraping
the public GST portal.

Auth — two headers:
    X-APISETU-CLIENTID : the API Setu client id (e.g. "tech.analytixkraft")
    X-APISETU-APIKEY   : the dashboard-generated API key

The GSTIN is passed in the URL path (GET, no body). There is no captcha, so
verification completes synchronously in ``start_verification``. The response
uses descriptive field names (``legalNameOfBusiness``, ``tradeName``,
``gstnStatus`` …), which this module maps onto the explicit keys understood by
the shared GST parser.
"""

from __future__ import annotations

import ssl
from typing import Any

import httpx
import truststore

from app.core.config import get_settings
from app.integrations.gst_verification.client import GSTVerificationClientStep

_TAXPAYER_PATH = "/gstn/v2/taxpayers"
_REQUEST_TIMEOUT = 30


def _join_jurisdiction(name: Any, code: Any) -> str | None:
    name_s = str(name).strip() if name else ""
    code_s = str(code).strip() if code else ""
    if name_s and code_s:
        return f"{name_s} ({code_s})"
    return name_s or code_s or None


def _format_principal_address(principal_fields: Any) -> str | None:
    """Flatten API Setu's principalPlaceOfBusinessFields into one readable line."""
    if not isinstance(principal_fields, dict):
        return None
    addr = principal_fields.get("principalPlaceOfBusinessAddress")
    if not isinstance(addr, dict):
        return None
    parts = [
        addr.get("floorNumber"),
        addr.get("buildingNumber"),
        addr.get("buildingName"),
        addr.get("streetName"),
        addr.get("locality") or addr.get("location"),
        addr.get("districtName"),
        addr.get("stateName"),
        addr.get("pincode"),
    ]
    cleaned = [str(p).strip() for p in parts if p and str(p).strip()]
    return ", ".join(cleaned) or None


def _format_additional_addresses(additional_fields: Any) -> str | None:
    """Flatten API Setu's additionalPlaceOfBusinessFields into one line per place."""
    if not isinstance(additional_fields, list) or not additional_fields:
        return None
    lines: list[str] = []
    for entry in additional_fields:
        if not isinstance(entry, dict):
            continue
        addr = entry.get("additionalPlaceOfBusinessAddress")
        if not isinstance(addr, dict):
            continue
        parts = [
            addr.get("floorNumber"),
            addr.get("buildingNumber"),
            addr.get("buildingName"),
            addr.get("streetName"),
            addr.get("locality") or addr.get("location"),
            addr.get("districtName"),
            addr.get("stateName"),
            addr.get("pincode"),
        ]
        line = ", ".join(str(p).strip() for p in parts if p and str(p).strip())
        nature = entry.get("natureOfAdditionalPlaceOfBusiness")
        if nature and str(nature).strip():
            line = f"{line} ({str(nature).strip()})" if line else str(nature).strip()
        if line:
            lines.append(line)
    return "\n".join(lines) or None


def _map_apisetu_response(
    *,
    gstin: str,
    status_code: int,
    body: dict[str, Any],
    source_url: str,
) -> GSTVerificationClientStep:
    """Pure mapper: API Setu HTTP response -> GSTVerificationClientStep."""
    if status_code in (401, 403):
        return GSTVerificationClientStep(
            state="FAILED",
            source_url=source_url,
            remarks=(
                "API Setu authentication failed — check X-APISETU-CLIENTID "
                "(SETU_CLIENT_ID) and X-APISETU-APIKEY (SETU_GST_KEY)."
            ),
        )

    if status_code != 200:
        message = str(
            body.get("errorDescription") or body.get("error") or body.get("message") or ""
        ).strip()
        return GSTVerificationClientStep(
            state="FAILED",
            source_url=source_url,
            remarks=f"API Setu returned HTTP {status_code}. {message}".strip(),
        )

    if not body.get("gstIdentificationNumber"):
        message = str(
            body.get("errorDescription") or body.get("message") or "GSTIN not found."
        ).strip()
        return GSTVerificationClientStep(
            state="FAILED",
            source_url=source_url,
            remarks=message,
            result_snapshot=None,
        )

    nba = body.get("natureOfBusinessActivity")
    snapshot: dict[str, Any] = {
        "gstin": (body.get("gstIdentificationNumber") or gstin or "").strip().upper(),
        "legal_name": body.get("legalNameOfBusiness") or None,
        "trade_name": body.get("tradeName") or None,
        "status": body.get("gstnStatus") or None,
        "taxpayer_type": body.get("taxpayerType") or None,
        "registration_date": body.get("dateOfRegistration") or None,  # DD/MM/YYYY
        "cancellation_date": body.get("dateOfCancellation") or None,
        "constitution": body.get("constitutionOfBusiness") or None,
        "state_jurisdiction": _join_jurisdiction(
            body.get("stateJurisdiction"), body.get("stateJurisdictionCode")
        ),
        "central_jurisdiction": _join_jurisdiction(
            body.get("centerJurisdiction"), body.get("centerJurisdictionCode")
        ),
        "principal_address": _format_principal_address(
            body.get("principalPlaceOfBusinessFields")
        ),
        "additional_addresses": _format_additional_addresses(
            body.get("additionalPlaceOfBusinessFields")
        ),
        "nature_of_business": nba if isinstance(nba, list) and nba else None,
        "einvoice_status": body.get("eInvoiceStatus") or None,
        "source": "apisetu",
        "last_updated_date": body.get("lastUpdatedDate") or None,
        "apisetu_raw": body,  # full raw block, preserved for traceability
    }

    return GSTVerificationClientStep(
        state="SUCCESS",
        source_url=source_url,
        result_snapshot=snapshot,
    )


def _request_taxpayer(
    *,
    gstin: str,
    base_url: str,
    headers: dict[str, str],
) -> tuple[int, dict[str, Any]]:
    """GET the taxpayer record from API Setu. Returns (status, json). Isolated for testing."""
    # API Setu's TLS certificate chains to a government root that is present in the
    # OS trust store (so curl succeeds) but not in certifi (so default httpx fails
    # with "self signed certificate in certificate chain"). Verify against the OS
    # trust store instead, matching curl/browser behaviour.
    ssl_ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    with httpx.Client(timeout=_REQUEST_TIMEOUT, verify=ssl_ctx) as http:
        resp = http.get(f"{base_url}{_TAXPAYER_PATH}/{gstin}", headers=headers)
        try:
            body = resp.json()
        except Exception:
            body = {"message": resp.text}
        return resp.status_code, body if isinstance(body, dict) else {"data": body}


class SetuGSTVerificationClient:
    """GSTVerificationClient backed by the API Setu GSTN endpoint (no captcha)."""

    def start_verification(self, *, gstin: str) -> GSTVerificationClientStep:
        settings = get_settings()
        base_url = (settings.setu_gst_base_url or "https://apisetu.gov.in").rstrip("/")
        normalized_gstin = gstin.strip().upper()
        source_url = f"{base_url}{_TAXPAYER_PATH}/{normalized_gstin}"

        if not (settings.setu_client_id and settings.setu_gst_key):
            return GSTVerificationClientStep(
                state="FAILED",
                source_url=source_url,
                remarks=(
                    "API Setu credentials are not configured. "
                    "Set SETU_CLIENT_ID and SETU_GST_KEY."
                ),
            )

        headers = {
            "accept": "application/json",
            "X-APISETU-CLIENTID": settings.setu_client_id,
            "X-APISETU-APIKEY": settings.setu_gst_key,
        }

        try:
            status_code, body = _request_taxpayer(
                gstin=normalized_gstin, base_url=base_url, headers=headers
            )
        except Exception as exc:  # network/TLS/timeout — fail gracefully, never 500
            return GSTVerificationClientStep(
                state="FAILED",
                source_url=source_url,
                remarks=f"API Setu request failed: {exc}",
            )

        return _map_apisetu_response(
            gstin=normalized_gstin, status_code=status_code, body=body, source_url=source_url
        )

    def resume_verification(
        self,
        *,
        gstin: str,
        captcha_value: str,
        session_context: dict[str, Any] | None,
    ) -> GSTVerificationClientStep:
        # API Setu has no captcha step; resume simply re-runs the direct lookup.
        _ = (captcha_value, session_context)
        return self.start_verification(gstin=gstin)
