"""
GST Taxpayer Verification Client
=================================
Automates taxpayer lookup against the GST portal at
https://services.gst.gov.in/services/searchtp.

Flow (per https://github.com/shubham-dube/GST-Verification-API)
-----------------------------------------------------------------
1. GET  /services/searchtp          — establishes server-side session (cookie)
2. GET  /services/captcha           — fetches captcha PNG (same session)
3. Solve captcha with an OpenAI vision model (gpt-4o)
4. POST /services/api/search/taxpayerDetails
        body: {"gstin": "...", "captcha": "..."}   (same session/cookie)
5. Parse JSON response.

SWEB_9000 in the response = invalid captcha -> retry with fresh session.

Manual fallback
---------------
When auto-solving fails, _fetch_fresh_captcha_session() is called to get a
live captcha + its session cookies, which are stored in session_context.
On resume the stored cookies are replayed so the user-provided captcha
matches the session the server expects.
"""

from __future__ import annotations

import base64
import time
from typing import Any

import httpx

from app.core.config import get_settings
from app.integrations.gst_verification.client import GSTVerificationClientStep

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_PORTAL_BASE = "https://services.gst.gov.in"
_PORTAL_URL = f"{_PORTAL_BASE}/services/searchtp"
_CAPTCHA_URL = f"{_PORTAL_BASE}/services/captcha"
_TAXPAYER_API_URL = f"{_PORTAL_BASE}/services/api/search/taxpayerDetails"

# gpt-4o reads the GST portal captcha far more reliably than gpt-4o-mini
# (~50% per attempt vs ~10-25% in testing), so with several retries auto-solve
# succeeds ~95%+ of the time and the manual-captcha fallback rarely triggers.
_CAPTCHA_MODEL = "gpt-4o"
MAX_CAPTCHA_ATTEMPTS = 5
_REQUEST_TIMEOUT = 30

_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


# ---------------------------------------------------------------------------
# OpenAI vision captcha solver
# ---------------------------------------------------------------------------

def _solve_captcha_with_openai(image_bytes: bytes, api_key: str) -> str:
    """Send the captcha PNG to the vision model and return the recognised text."""
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    image_b64 = base64.b64encode(image_bytes).decode()

    response = client.chat.completions.create(
        model=_CAPTCHA_MODEL,
        max_tokens=20,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                    },
                    {
                        "type": "text",
                        "text": (
                            "This is a 6-character alphanumeric captcha from the Indian "
                            "GST portal. Reply with ONLY the exact characters shown — "
                            "uppercase, no spaces, no punctuation."
                        ),
                    },
                ],
            }
        ],
    )
    return (response.choices[0].message.content or "").strip()


# ---------------------------------------------------------------------------
# Low-level POST helper (shared by auto and manual paths)
# ---------------------------------------------------------------------------

def _post_taxpayer(
    http: httpx.Client,
    *,
    gstin: str,
    captcha_text: str,
) -> GSTVerificationClientStep | None:
    """POST the taxpayer lookup on an already-established httpx session.

    Returns None on SWEB_9000 (wrong captcha), a step otherwise.
    """
    api_resp = http.post(
        _TAXPAYER_API_URL,
        json={"gstin": gstin.strip().upper(), "captcha": captcha_text},
        headers={"Referer": _PORTAL_URL, "Accept": "application/json"},
    )
    api_resp.raise_for_status()

    try:
        data = api_resp.json()
    except Exception:
        return GSTVerificationClientStep(
            state="FAILED",
            source_url=_PORTAL_URL,
            remarks=f"Portal returned non-JSON response: {api_resp.text[:200]}",
        )

    if not isinstance(data, dict):
        return GSTVerificationClientStep(
            state="FAILED",
            source_url=_PORTAL_URL,
            remarks="Unexpected response type from GST portal.",
        )

    error_code = data.get("errorCode") or data.get("error_code") or ""

    if error_code == "SWEB_9000":
        return None  # wrong captcha -> signal caller to retry

    if error_code:
        return GSTVerificationClientStep(
            state="FAILED",
            source_url=_PORTAL_URL,
            remarks=f"GST portal error {error_code}: {data.get('message') or ''}",
            result_snapshot=data,
        )

    if data.get("lgnm") or data.get("gstin"):
        return GSTVerificationClientStep(
            state="SUCCESS",
            source_url=_PORTAL_URL,
            result_snapshot=data,
        )

    return GSTVerificationClientStep(
        state="FAILED",
        source_url=_PORTAL_URL,
        remarks="Portal returned an unexpected response structure.",
        result_snapshot=data,
    )


# ---------------------------------------------------------------------------
# Core HTTP attempt  (one full session: seed -> captcha -> solve -> POST)
# ---------------------------------------------------------------------------

def _attempt(
    *,
    gstin: str,
    explicit_captcha: str | None,
    api_key: str | None,
) -> GSTVerificationClientStep | None:
    """
    One full attempt using a fresh HTTP session (so cookies are clean).

    Returns a GSTVerificationClientStep on definitive success or failure.
    Returns None when the captcha was wrong (caller should retry).
    """
    with httpx.Client(
        timeout=_REQUEST_TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": _BROWSER_UA},
    ) as http:
        # 1. Seed the session
        http.get(_PORTAL_URL)

        # 2. Fetch captcha image (same session = same server-side cookie)
        captcha_resp = http.get(
            _CAPTCHA_URL,
            params={"rnd": str(int(time.time() * 1000))},
            headers={"Referer": _PORTAL_URL},
        )
        captcha_resp.raise_for_status()

        # The GST portal sits behind an anti-bot WAF that, when it does not
        # trust the client, returns an HTML "Request Rejected" page (HTTP 200)
        # instead of the captcha PNG. raise_for_status() passes, so without this
        # guard the HTML blob would be sent to the vision model as a fake image
        # (-> invalid_image_format), get swallowed by the retry loop, and waste
        # every attempt before silently falling back. Detect it and stop early.
        content_type = captcha_resp.headers.get("content-type", "").lower()
        if not content_type.startswith("image/"):
            return GSTVerificationClientStep(
                state="CAPTCHA_REQUIRED",
                source_url=_PORTAL_URL,
                remarks=(
                    "The GST portal's anti-bot protection returned a non-image "
                    f"captcha response (content-type={content_type!r}, "
                    f"{len(captcha_resp.content)} bytes); automated captcha "
                    "fetching is being blocked."
                ),
                challenge_text=(
                    "Automatic captcha solving is blocked by the GST portal. "
                    "Open the GST portal, solve the captcha manually, then "
                    "enter the value here."
                ),
            )

        # 3. Solve captcha
        if explicit_captcha is not None:
            captcha_text = explicit_captcha.strip()
        elif api_key:
            captcha_text = _solve_captcha_with_openai(captcha_resp.content, api_key)
        else:
            return GSTVerificationClientStep(
                state="CAPTCHA_REQUIRED",
                source_url=_PORTAL_URL,
                remarks=(
                    "No OpenAI API key configured. "
                    "Set OPENAI_API_KEY to enable automatic captcha solving."
                ),
                challenge_text=(
                    "Auto captcha solving is not configured. "
                    "Open the GST portal, solve the captcha manually, "
                    "then enter the value here."
                ),
            )

        # 4. POST {gstin, captcha} with the same session cookies
        return _post_taxpayer(http, gstin=gstin, captcha_text=captcha_text)


# ---------------------------------------------------------------------------
# Manual-fallback helper: fetch a live captcha and keep its session cookies
# ---------------------------------------------------------------------------

def _fetch_fresh_captcha_session() -> tuple[dict[str, str], bytes] | None:
    """
    Open a fresh GST portal session, fetch the captcha image and return
    (cookies_dict, captcha_bytes) so the caller can show the image to the
    user and later replay the cookies when the user submits the solution.

    Returns None on any network/HTTP failure.
    """
    try:
        with httpx.Client(
            timeout=_REQUEST_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": _BROWSER_UA},
        ) as http:
            http.get(_PORTAL_URL)
            captcha_resp = http.get(
                _CAPTCHA_URL,
                params={"rnd": str(int(time.time() * 1000))},
                headers={"Referer": _PORTAL_URL},
            )
            captcha_resp.raise_for_status()
            if not captcha_resp.headers.get("content-type", "").lower().startswith("image/"):
                # WAF returned an HTML block, not the captcha image — don't
                # store a non-image blob to show the user as a captcha.
                return None
            return dict(http.cookies), captcha_resp.content
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Replay a stored session: POST using previously captured cookies
# ---------------------------------------------------------------------------

def _attempt_with_stored_cookies(
    *,
    gstin: str,
    captcha_text: str,
    cookies: dict[str, str],
) -> GSTVerificationClientStep | None:
    """
    POST the taxpayer lookup using cookies captured during the manual-fallback
    flow, so the captcha value matches the session the server expects.

    Returns a GSTVerificationClientStep on definitive success/failure, or
    None when the captcha was wrong.
    """
    with httpx.Client(
        timeout=_REQUEST_TIMEOUT,
        follow_redirects=True,
        headers={"User-Agent": _BROWSER_UA},
        cookies=cookies,
    ) as http:
        return _post_taxpayer(http, gstin=gstin, captcha_text=captcha_text)


# ---------------------------------------------------------------------------
# Public client class
# ---------------------------------------------------------------------------

class GSTPortalVerificationClient:
    """
    Implements GSTVerificationClient for services.gst.gov.in.

    start_verification  -- fully automated; tries up to MAX_CAPTCHA_ATTEMPTS
                           times with the vision model before falling back to
                           CAPTCHA_REQUIRED (manual mode).  The fallback also
                           fetches a live captcha image and stores it (base64)
                           along with the session cookies in session_context,
                           so the user solves *our* captcha -- not one from a
                           separate browser session.

    resume_verification -- called from the manual fallback UI.  If the stored
                           session cookies are available it replays them so the
                           submitted captcha text is validated against the same
                           server-side session.
    """

    def start_verification(self, *, gstin: str) -> GSTVerificationClientStep:
        settings = get_settings()
        api_key = settings.openai_api_key

        last_exc: Exception | None = None
        for _ in range(MAX_CAPTCHA_ATTEMPTS):
            try:
                result = _attempt(
                    gstin=gstin,
                    explicit_captcha=None,
                    api_key=api_key,
                )
            except Exception as exc:
                last_exc = exc
                continue

            if result is not None:
                return result
            # result is None -> wrong captcha, retry with a fresh session

        failure_note = f" Last error: {last_exc}" if last_exc else ""

        # Fetch a fresh captcha session for the manual fallback so we can
        # show the user the actual image they need to solve.
        session_data: dict[str, Any] = {"gstin": gstin}
        challenge = (
            "Automatic captcha solving was unsuccessful. "
            "Solve the captcha shown below, then click 'Continue Verification'."
        )
        fresh = _fetch_fresh_captcha_session()
        if fresh:
            cookies, captcha_bytes = fresh
            session_data["cookies"] = cookies
            session_data["captcha_image_b64"] = base64.b64encode(captcha_bytes).decode()
        else:
            challenge = (
                "Automatic captcha solving was unsuccessful. "
                "Open the GST portal, solve the captcha manually, "
                "then enter the value here."
            )

        return GSTVerificationClientStep(
            state="CAPTCHA_REQUIRED",
            source_url=_PORTAL_URL,
            remarks=(
                f"Auto captcha solving failed after {MAX_CAPTCHA_ATTEMPTS} attempts.{failure_note}"
            ),
            session_context=session_data,
            challenge_text=challenge,
        )

    def resume_verification(
        self,
        *,
        gstin: str,
        captcha_value: str,
        session_context: dict[str, Any] | None,
    ) -> GSTVerificationClientStep:
        settings = get_settings()
        api_key = settings.openai_api_key

        # Try the user-supplied captcha with the stored session cookies first.
        # This ensures the captcha value matches the server session we created
        # during the fallback (the one whose image was shown to the user).
        stored_cookies: dict[str, str] | None = (
            session_context.get("cookies") if session_context else None
        )
        if stored_cookies and captcha_value.strip():
            try:
                result = _attempt_with_stored_cookies(
                    gstin=gstin,
                    captcha_text=captcha_value.strip(),
                    cookies=stored_cookies,
                )
                if result is not None:
                    return result
            except Exception:
                pass

        # Auto-solve fallback with fresh sessions
        for _ in range(MAX_CAPTCHA_ATTEMPTS):
            try:
                result = _attempt(
                    gstin=gstin,
                    explicit_captcha=None,
                    api_key=api_key,
                )
                if result is not None:
                    return result
            except Exception:
                continue

        return GSTVerificationClientStep(
            state="FAILED",
            source_url=_PORTAL_URL,
            remarks="Verification failed: both manual and auto captcha solving were unsuccessful.",
        )
