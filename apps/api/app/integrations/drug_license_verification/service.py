from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.integrations.drug_license_verification.client import (
    VerificationClientStep,
    get_drug_license_verification_client,
)
from app.integrations.drug_license_verification.parser import (
    ParsedDrugLicenseResult,
    parse_result_snapshot,
)
from app.models.drug_license import DrugLicenseVerificationLog
from app.models.enums import DrugLicenseVerificationLogStatus, DrugLicenseVerifiedStatus
from app.models.party import Party


@dataclass(slots=True)
class DrugLicenseWorkflowState:
    log: DrugLicenseVerificationLog
    verification_state: str
    challenge_text: str | None
    result: ParsedDrugLicenseResult | None
    can_resume: bool
    can_save: bool


def start_verification(
    db: Session,
    *,
    party: Party | None,
    drug_license_number: str,
    requested_by: int,
) -> DrugLicenseWorkflowState:
    client = get_drug_license_verification_client()
    step = client.start_verification(license_number=drug_license_number)

    log = DrugLicenseVerificationLog(
        party_id=party.id if party is not None else None,
        drug_license_number=drug_license_number,
        requested_by=requested_by,
    )
    workflow = _apply_step_to_log(log, license_number=drug_license_number, step=step)
    db.add(log)
    db.flush()
    return workflow


def resume_verification(
    *,
    log: DrugLicenseVerificationLog,
    captcha_value: str,
) -> DrugLicenseWorkflowState:
    if log.status != DrugLicenseVerificationLogStatus.CAPTCHA_REQUIRED.value:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="This verification session is not waiting for captcha input.",
            status_code=400,
        )

    session_context = _read_session_context(log.extracted_data_json)
    client = get_drug_license_verification_client()
    step = client.resume_verification(
        license_number=log.drug_license_number,
        captcha_value=captcha_value,
        session_context=session_context,
    )
    return _apply_step_to_log(log, license_number=log.drug_license_number, step=step)


def save_verified_data(
    *,
    log: DrugLicenseVerificationLog,
    party: Party,
    saved_by: int,
    remarks: str | None = None,
) -> ParsedDrugLicenseResult:
    if log.status != DrugLicenseVerificationLogStatus.SUCCESS.value:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Only successful verification results can be saved to Party Master.",
            status_code=400,
        )

    parsed = _read_parsed_result(log.extracted_data_json)
    if parsed is None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="No parsed verification data is available to save.",
            status_code=400,
        )

    party.drug_license_number = parsed.license_number
    party.drug_license_verified_status = _derive_party_verified_status(parsed).value
    party.drug_license_verified_at = datetime.now(timezone.utc)
    party.drug_license_verified_by = saved_by
    party.drug_license_verification_source = log.source_url
    party.drug_license_holder_name = parsed.holder_name
    party.drug_license_valid_upto = parsed.valid_upto
    party.drug_license_state = parsed.state
    party.drug_license_raw_snapshot = parsed.raw_snapshot

    if remarks:
        log.remarks = remarks

    return parsed


def _apply_step_to_log(
    log: DrugLicenseVerificationLog,
    *,
    license_number: str,
    step: VerificationClientStep,
) -> DrugLicenseWorkflowState:
    result: ParsedDrugLicenseResult | None = None
    log_status = _normalize_log_status(step.state)

    extracted_data: dict[str, Any] = {
        "license_number": license_number,
        "session_context": step.session_context,
        "challenge_text": step.challenge_text,
        "portal_state": step.state,
    }

    if step.result_snapshot is not None:
        try:
            result = parse_result_snapshot(
                license_number=license_number,
                snapshot=step.result_snapshot,
            )
        except Exception:
            log_status = DrugLicenseVerificationLogStatus.PARSE_FAILED
        else:
            extracted_data["result"] = {
                **asdict(result),
                "valid_upto": result.valid_upto.isoformat() if result.valid_upto is not None else None,
            }

    log.status = log_status.value
    log.source_url = step.source_url
    log.remarks = step.remarks
    log.extracted_data_json = extracted_data
    log.response_snapshot = _serialize_snapshot(step.result_snapshot)

    return DrugLicenseWorkflowState(
        log=log,
        verification_state=step.state,
        challenge_text=step.challenge_text,
        result=result if log_status == DrugLicenseVerificationLogStatus.SUCCESS else None,
        can_resume=log_status == DrugLicenseVerificationLogStatus.CAPTCHA_REQUIRED,
        can_save=log_status == DrugLicenseVerificationLogStatus.SUCCESS and result is not None and log.party_id is not None,
    )


def _normalize_log_status(state: str) -> DrugLicenseVerificationLogStatus:
    normalized = state.strip().upper()
    if normalized in {
        DrugLicenseVerificationLogStatus.SUCCESS.value,
        "VERIFIED",
    }:
        return DrugLicenseVerificationLogStatus.SUCCESS
    if normalized == DrugLicenseVerificationLogStatus.CAPTCHA_REQUIRED.value:
        return DrugLicenseVerificationLogStatus.CAPTCHA_REQUIRED
    if normalized == DrugLicenseVerificationLogStatus.PARSE_FAILED.value:
        return DrugLicenseVerificationLogStatus.PARSE_FAILED
    return DrugLicenseVerificationLogStatus.FAILED


def _serialize_snapshot(snapshot: str | dict[str, Any] | None) -> str | None:
    if snapshot is None:
        return None
    if isinstance(snapshot, str):
        return snapshot
    return json.dumps(snapshot, default=str)


def _read_session_context(payload: dict[str, Any] | None) -> dict[str, Any] | None:
    if not payload:
        return None
    raw_context = payload.get("session_context")
    return raw_context if isinstance(raw_context, dict) else None


def _read_parsed_result(payload: dict[str, Any] | None) -> ParsedDrugLicenseResult | None:
    if not payload:
        return None
    raw_result = payload.get("result")
    if not isinstance(raw_result, dict):
        return None
    parsed_result = parse_result_snapshot(
        license_number=str(raw_result.get("license_number") or "").strip(),
        snapshot={
            **raw_result,
            "valid_upto": raw_result.get("valid_upto"),
        },
    )
    return ParsedDrugLicenseResult(
        license_number=parsed_result.license_number,
        holder_name=parsed_result.holder_name,
        status=parsed_result.status,
        valid_upto=parsed_result.valid_upto,
        authority=parsed_result.authority,
        state=parsed_result.state,
        raw_snapshot=parsed_result.raw_snapshot,
    )


def _derive_party_verified_status(parsed: ParsedDrugLicenseResult) -> DrugLicenseVerifiedStatus:
    if parsed.valid_upto is not None and parsed.valid_upto < datetime.now(timezone.utc).date():
        return DrugLicenseVerifiedStatus.EXPIRED
    return DrugLicenseVerifiedStatus.VERIFIED

