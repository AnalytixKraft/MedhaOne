from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from app.core.config import get_settings


@dataclass(slots=True)
class VerificationClientStep:
    state: str
    source_url: str | None
    remarks: str | None = None
    session_context: dict[str, Any] | None = None
    result_snapshot: str | dict[str, Any] | None = None
    challenge_text: str | None = None


class DrugLicenseVerificationClient(Protocol):
    def start_verification(self, *, license_number: str) -> VerificationClientStep:
        ...

    def resume_verification(
        self,
        *,
        license_number: str,
        captcha_value: str,
        session_context: dict[str, Any] | None,
    ) -> VerificationClientStep:
        ...


class ManualCaptchaDrugLicenseVerificationClient:
    def start_verification(self, *, license_number: str) -> VerificationClientStep:
        settings = get_settings()
        return VerificationClientStep(
            state="CAPTCHA_REQUIRED",
            source_url=settings.drug_licence_verify_url,
            remarks=(
                "Manual captcha entry is required. Open the source portal, complete the captcha, "
                "then submit the captcha value to continue verification."
            ),
            session_context={
                "license_number": license_number,
                "verification_url": settings.drug_licence_verify_url,
                "has_credentials": bool(
                    settings.drug_licence_verify_username and settings.drug_licence_verify_password
                ),
            },
            challenge_text="Captcha must be entered manually from the source portal.",
        )

    def resume_verification(
        self,
        *,
        license_number: str,
        captcha_value: str,
        session_context: dict[str, Any] | None,
    ) -> VerificationClientStep:
        _ = session_context
        return VerificationClientStep(
            state="FAILED",
            source_url=get_settings().drug_licence_verify_url,
            remarks=(
                "The live drug licence portal adapter is not configured. "
                "Inject a concrete verification client for the target state portal."
            ),
            session_context={"license_number": license_number, "captcha_value": captcha_value},
        )


_client: DrugLicenseVerificationClient = ManualCaptchaDrugLicenseVerificationClient()


def get_drug_license_verification_client() -> DrugLicenseVerificationClient:
    return _client


def set_drug_license_verification_client(client: DrugLicenseVerificationClient) -> None:
    global _client
    _client = client
