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
    # A confirmed "no record" result must clear any stale verified status the
    # party still carries for this licence, so the Party form stops showing it
    # as verified.
    if party is not None and (log.extracted_data_json or {}).get("match_found") is False:
        _clear_party_verified_for_no_match(party, drug_license_number)
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
    slot: int = 1,
) -> ParsedDrugLicenseResult:
    if slot not in (1, 2):
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Drug licence slot must be 1 or 2.",
            status_code=400,
            details={"field": "slot"},
        )
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

    # Slot 1 and slot 2 share an identical set of columns, differing only by the
    # "drug_license_2_" prefix. Resolve the prefix once and write through setattr.
    prefix = "drug_license_" if slot == 1 else "drug_license_2_"
    number_attr = "drug_license_number" if slot == 1 else "drug_license_2_number"

    setattr(party, number_attr, parsed.license_number)
    setattr(party, f"{prefix}verified_status", _derive_party_verified_status(parsed).value)
    setattr(party, f"{prefix}verified_at", datetime.now(timezone.utc))
    setattr(party, f"{prefix}verified_by", saved_by)
    setattr(party, f"{prefix}verification_source", log.source_url)
    setattr(party, f"{prefix}holder_name", parsed.holder_name)
    setattr(party, f"{prefix}valid_upto", parsed.valid_upto)
    setattr(party, f"{prefix}state", parsed.state)
    setattr(party, f"{prefix}raw_snapshot", parsed.raw_snapshot)

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

    no_match = False
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
            # A 200 response with no licence details (e.g. a "no record found"
            # page) parses into an empty result and must NOT count as verified.
            if (
                log_status == DrugLicenseVerificationLogStatus.SUCCESS
                and not _result_indicates_match(result)
            ):
                log_status = DrugLicenseVerificationLogStatus.FAILED
                no_match = True
                extracted_data["match_found"] = False

    log.status = log_status.value
    log.source_url = step.source_url
    log.remarks = (
        "No matching licence record was returned by the portal for this number."
        if no_match
        else step.remarks
    )
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


def _clear_party_verified_for_no_match(party: Party, license_number: str) -> None:
    """Downgrade a party's stored verified status to FAILED for the licence slot
    matching this number, after a confirmed "no record" result. Only the slot
    whose number matches is touched; the other slot is left untouched.
    """
    normalized = (license_number or "").strip().lower()
    if not normalized:
        return
    now = datetime.now(timezone.utc)
    if (party.drug_license_number or "").strip().lower() == normalized:
        party.drug_license_verified_status = DrugLicenseVerifiedStatus.FAILED.value
        party.drug_license_verified_at = now
        party.drug_license_holder_name = None
        party.drug_license_valid_upto = None
    if (party.drug_license_2_number or "").strip().lower() == normalized:
        party.drug_license_2_verified_status = DrugLicenseVerifiedStatus.FAILED.value
        party.drug_license_2_verified_at = now
        party.drug_license_2_holder_name = None
        party.drug_license_2_valid_upto = None


def _result_indicates_match(parsed: ParsedDrugLicenseResult | None) -> bool:
    """True only when the portal actually returned licence details.

    A "no record found" page parses into an all-empty result (only the echoed
    input licence number), which must not be treated as a verified match.
    """
    if parsed is None:
        return False
    return any(
        field is not None
        for field in (parsed.holder_name, parsed.status, parsed.valid_upto, parsed.authority)
    )


def _derive_party_verified_status(parsed: ParsedDrugLicenseResult) -> DrugLicenseVerifiedStatus:
    if not _result_indicates_match(parsed):
        return DrugLicenseVerifiedStatus.FAILED
    if parsed.valid_upto is not None and parsed.valid_upto < datetime.now(timezone.utc).date():
        return DrugLicenseVerifiedStatus.EXPIRED
    return DrugLicenseVerifiedStatus.VERIFIED

