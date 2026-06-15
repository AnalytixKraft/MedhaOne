from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(slots=True)
class GSTVerificationClientStep:
    state: str
    source_url: str | None
    remarks: str | None = None
    session_context: dict[str, Any] | None = None
    result_snapshot: str | dict[str, Any] | None = None
    challenge_text: str | None = None


class GSTVerificationClient(Protocol):
    def start_verification(self, *, gstin: str) -> GSTVerificationClientStep:
        ...

    def resume_verification(
        self,
        *,
        gstin: str,
        captcha_value: str,
        session_context: dict[str, Any] | None,
    ) -> GSTVerificationClientStep:
        ...


class ManualCaptchaGSTVerificationClient:
    def start_verification(self, *, gstin: str) -> GSTVerificationClientStep:
        return GSTVerificationClientStep(
            state="CAPTCHA_REQUIRED",
            source_url="https://services.gst.gov.in/services/searchtp",
            remarks=(
                "Manual captcha entry is required. Open the GST portal, complete the captcha, "
                "then submit the captcha value to continue verification."
            ),
            session_context={"gstin": gstin},
            challenge_text="Captcha must be entered manually from the GST portal.",
        )

    def resume_verification(
        self,
        *,
        gstin: str,
        captcha_value: str,
        session_context: dict[str, Any] | None,
    ) -> GSTVerificationClientStep:
        _ = session_context
        return GSTVerificationClientStep(
            state="FAILED",
            source_url="https://services.gst.gov.in/services/searchtp",
            remarks=(
                "The live GST portal adapter is not configured. "
                "The automated client is required to complete verification."
            ),
            session_context={"gstin": gstin, "captcha_value": captcha_value},
        )


_client: GSTVerificationClient = ManualCaptchaGSTVerificationClient()


def get_gst_verification_client() -> GSTVerificationClient:
    return _client


def set_gst_verification_client(client: GSTVerificationClient) -> None:
    global _client
    _client = client
