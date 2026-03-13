"""
SFDA Drug Licence Verification Client
======================================
Automates licence verification against the State Food and Drug Administration
portal at https://statedrugs.gov.in/SFDA/third-part-licence-verification.html.

Flow
----
1. GET the portal page — establishes a server-side HTTP session and reads the
   CSRF meta tags.
2. Fetch the jCaptcha image from /SFDA/jcaptcha.jpg.
3. Send the image to Claude Haiku (vision) and read the captcha text.
4. Encode the text using the triple-Base64/reverse scheme the portal's JS uses.
5. POST to /SFDA/AppJCaptcha to validate the captcha against the server session.
6. POST the main form with licenceNumber + jcaptcha (raw text).
7. Return a VerificationClientStep with the HTML/JSON result snapshot.

If Claude fails to read the captcha (or the API key is absent), the client
retries up to MAX_CAPTCHA_ATTEMPTS times.  After all retries are exhausted it
returns CAPTCHA_REQUIRED so the existing manual fallback UI still works.
"""

from __future__ import annotations

import base64
import re
import time
from typing import Any

import httpx

from app.core.config import get_settings
from app.integrations.drug_license_verification.client import VerificationClientStep

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_PORTAL_BASE = "https://statedrugs.gov.in"
_PORTAL_URL = f"{_PORTAL_BASE}/SFDA/third-part-licence-verification.html"
_CAPTCHA_IMG_URL = f"{_PORTAL_BASE}/SFDA/jcaptcha.jpg"
_CAPTCHA_VALIDATE_URL = f"{_PORTAL_BASE}/SFDA/AppJCaptcha"
_VERIFY_LICENSE_URL = f"{_PORTAL_BASE}/SFDA/verifyLicense"

MAX_CAPTCHA_ATTEMPTS = 3
_REQUEST_TIMEOUT = 30


# ---------------------------------------------------------------------------
# Captcha encoding  (Python replication of the portal's JS)
# ---------------------------------------------------------------------------

def _encode_captcha(captcha_text: str) -> str:
    """
    Replicates the JS triple-encoding:
        r1 = btoa(captcha_text)
        r2 = reverseString(r1)
        return btoa(r2)
    """
    r1 = base64.b64encode(captcha_text.encode()).decode()
    r2 = r1[::-1]
    return base64.b64encode(r2.encode()).decode()


def _captcha_response_is_valid(response_text: str, encoded_captcha: str) -> bool:
    """
    Check the /SFDA/AppJCaptcha response against the JS success condition:
        encvaldata    = data_Text + captcha_Text
        encvaldataenc = btoa(encvaldata)
        valid         = (response == encvaldataenc)

    where:
        data_Text = btoa(reverseString(btoa("This is a truevalue")))
    """
    true_val = "This is a truevalue"
    r1 = base64.b64encode(true_val.encode()).decode()
    r2 = r1[::-1]
    data_text = base64.b64encode(r2.encode()).decode()

    encvaldata = data_text + encoded_captcha
    expected = base64.b64encode(encvaldata.encode()).decode()
    return response_text.strip() == expected


# ---------------------------------------------------------------------------
# CSRF helpers
# ---------------------------------------------------------------------------

def _extract_csrf(html: str) -> tuple[str | None, str | None]:
    """Return (token, header_name) from the page's <meta> CSRF tags."""
    token_match = re.search(r'<meta\s+name="_csrf"\s+content="([^"]+)"', html)
    header_match = re.search(r'<meta\s+name="_csrf_header"\s+content="([^"]+)"', html)
    token = token_match.group(1) if token_match else None
    header = header_match.group(1) if header_match else None
    return token, header


# ---------------------------------------------------------------------------
# Claude vision captcha solver
# ---------------------------------------------------------------------------

def _solve_captcha_with_openai(image_bytes: bytes, api_key: str) -> str:
    """
    Send the captcha image to GPT-4o-mini and return the recognised text.
    gpt-4o-mini is fast and cheap — ideal for simple alphanumeric captchas.
    """
    from openai import OpenAI  # imported here so the package is optional at import time

    client = OpenAI(api_key=api_key)
    image_b64 = base64.b64encode(image_bytes).decode()

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        max_tokens=20,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                    },
                    {
                        "type": "text",
                        "text": (
                            "This is a captcha image. "
                            "Reply with ONLY the exact characters you see — "
                            "no spaces, no punctuation, just the captcha text."
                        ),
                    },
                ],
            }
        ],
    )
    return response.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# Core HTTP attempt
# ---------------------------------------------------------------------------

def _attempt(
    *,
    license_number: str,
    explicit_captcha: str | None,
    api_key: str | None,
) -> VerificationClientStep | None:
    """
    One full attempt: get page → get captcha → solve/use → validate → submit.

    Returns a VerificationClientStep on definitive success or failure.
    Returns None when the captcha was simply wrong (caller should retry).
    """
    with httpx.Client(timeout=_REQUEST_TIMEOUT, follow_redirects=True) as http:
        # 1. Load the portal page — establishes server-side session (JSESSIONID cookie)
        page_resp = http.get(_PORTAL_URL)
        page_resp.raise_for_status()
        csrf_token, csrf_header = _extract_csrf(page_resp.text)
        extra_headers: dict[str, str] = {}
        if csrf_token and csrf_header:
            extra_headers[csrf_header] = csrf_token

        # 2. Fetch captcha image (cache-bust with timestamp)
        captcha_resp = http.get(
            _CAPTCHA_IMG_URL,
            params={"_": str(int(time.time() * 1000))},
            headers=extra_headers,
        )
        captcha_resp.raise_for_status()

        # 3. Determine captcha text
        if explicit_captcha is not None:
            captcha_text = explicit_captcha.strip().upper()
        elif api_key:
            captcha_text = _solve_captcha_with_openai(captcha_resp.content, api_key)
        else:
            # No solver and no explicit value — can't proceed
            return VerificationClientStep(
                state="CAPTCHA_REQUIRED",
                source_url=_PORTAL_URL,
                remarks=(
                    "No Anthropic API key is configured. "
                    "Set ANTHROPIC_API_KEY to enable automatic captcha solving."
                ),
                challenge_text=(
                    "Auto captcha solving is not configured. "
                    "Open the source portal, complete the captcha, "
                    "then submit the value here."
                ),
            )

        # 4. Validate captcha with the server (same httpx session = same JSESSIONID)
        encoded = _encode_captcha(captcha_text)
        validate_resp = http.post(
            _CAPTCHA_VALIDATE_URL,
            data={"jcaptcha": encoded},
            headers=extra_headers,
        )

        if not _captcha_response_is_valid(validate_resp.text, encoded):
            # Wrong captcha — signal caller to retry with a fresh image
            return None

        # 5. Submit the licence verification form
        form_resp = http.post(
            _PORTAL_URL,
            data={"licenceNumber": license_number, "jcaptcha": captcha_text},
            headers={
                **extra_headers,
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": _PORTAL_URL,
            },
        )
        form_resp.raise_for_status()

        # 6. Also try the lightweight AJAX endpoint as a supplementary source
        ajax_resp = http.get(
            _VERIFY_LICENSE_URL,
            params={"licenseNo": license_number},
            headers=extra_headers,
        )

        # Prefer the AJAX JSON if available, otherwise use the full HTML page
        result_snapshot: str | dict[str, Any]
        if ajax_resp.status_code == 200 and ajax_resp.text.strip().startswith("{"):
            try:
                import json
                result_snapshot = json.loads(ajax_resp.text)
            except Exception:
                result_snapshot = form_resp.text
        else:
            result_snapshot = form_resp.text

        return VerificationClientStep(
            state="SUCCESS",
            source_url=_PORTAL_URL,
            result_snapshot=result_snapshot,
        )


# ---------------------------------------------------------------------------
# Public client class
# ---------------------------------------------------------------------------

class SFDADrugLicenseVerificationClient:
    """
    Implements DrugLicenseVerificationClient for the statedrugs.gov.in portal.

    start_verification  — fully automated; tries up to MAX_CAPTCHA_ATTEMPTS
                          times with Claude Haiku before falling back to
                          CAPTCHA_REQUIRED (manual mode).

    resume_verification — called from the manual fallback UI.  It tries the
                          user-supplied captcha value first, then falls back
                          to auto-solve so that a single click on
                          "Continue Verification" is usually enough.
    """

    def start_verification(self, *, license_number: str) -> VerificationClientStep:
        settings = get_settings()
        api_key = settings.openai_api_key

        last_exc: Exception | None = None
        for _ in range(MAX_CAPTCHA_ATTEMPTS):
            try:
                result = _attempt(
                    license_number=license_number,
                    explicit_captcha=None,
                    api_key=api_key,
                )
            except Exception as exc:
                last_exc = exc
                continue

            if result is not None:
                # Either SUCCESS, FAILED, or CAPTCHA_REQUIRED (no API key)
                return result
            # result is None → wrong captcha, retry with fresh image

        # All attempts exhausted — fall back to manual
        failure_note = f" Last error: {last_exc}" if last_exc else ""
        return VerificationClientStep(
            state="CAPTCHA_REQUIRED",
            source_url=_PORTAL_URL,
            remarks=(
                f"Auto captcha solving failed after {MAX_CAPTCHA_ATTEMPTS} attempts.{failure_note}"
            ),
            session_context={
                "license_number": license_number,
                "verification_url": _PORTAL_URL,
            },
            challenge_text=(
                "Automatic captcha solving was unsuccessful. "
                "Open the source portal, complete the captcha manually, "
                "then click 'Continue Verification' here."
            ),
        )

    def resume_verification(
        self,
        *,
        license_number: str,
        captcha_value: str,
        session_context: dict[str, Any] | None,
    ) -> VerificationClientStep:
        _ = session_context
        settings = get_settings()
        api_key = settings.openai_api_key

        # Try with the user's explicit captcha value first
        try:
            result = _attempt(
                license_number=license_number,
                explicit_captcha=captcha_value,
                api_key=api_key,
            )
            if result is not None:
                return result
        except Exception:
            pass

        # User's value was wrong or the attempt failed — try auto-solving
        for _ in range(MAX_CAPTCHA_ATTEMPTS):
            try:
                result = _attempt(
                    license_number=license_number,
                    explicit_captcha=None,
                    api_key=api_key,
                )
                if result is not None:
                    return result
            except Exception:
                continue

        return VerificationClientStep(
            state="FAILED",
            source_url=_PORTAL_URL,
            remarks="Verification failed: both manual and auto captcha solving were unsuccessful.",
        )
