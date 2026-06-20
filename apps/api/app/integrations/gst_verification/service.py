from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppException
from app.integrations.gst_verification.client import (
    GSTVerificationClientStep,
    get_gst_verification_client,
)
from app.integrations.gst_verification.parser import (
    ParsedGSTResult,
    parse_result_snapshot,
)
from app.models.gst_verification import GSTVerificationLog
from app.models.enums import GSTVerificationLogStatus
from app.models.party import Party


@dataclass(slots=True)
class GSTWorkflowState:
    log: GSTVerificationLog
    verification_state: str
    challenge_text: str | None
    result: ParsedGSTResult | None
    can_resume: bool
    can_save: bool


def start_verification(
    db: Session,
    *,
    party: Party | None,
    gstin: str,
    requested_by: int,
) -> GSTWorkflowState:
    client = get_gst_verification_client()
    step = client.start_verification(gstin=gstin)

    log = GSTVerificationLog(
        party_id=party.id if party is not None else None,
        gstin=gstin.strip().upper(),
        requested_by=requested_by,
    )
    workflow = _apply_step_to_log(log, gstin=gstin, step=step)
    db.add(log)
    db.flush()
    return workflow


def resume_verification(
    *,
    log: GSTVerificationLog,
    captcha_value: str,
) -> GSTWorkflowState:
    if log.status != GSTVerificationLogStatus.CAPTCHA_REQUIRED.value:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="This verification session is not waiting for captcha input.",
            status_code=400,
        )

    session_context = _read_session_context(log.extracted_data_json)
    client = get_gst_verification_client()
    step = client.resume_verification(
        gstin=log.gstin,
        captcha_value=captcha_value,
        session_context=session_context,
    )
    return _apply_step_to_log(log, gstin=log.gstin, step=step)


def save_verified_data(
    *,
    log: GSTVerificationLog,
    party: Party,
    saved_by: int,
    remarks: str | None = None,
) -> ParsedGSTResult:
    if log.status != GSTVerificationLogStatus.SUCCESS.value:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="Only successful verification results can be saved to Party Master.",
            status_code=400,
        )

    parsed = _read_parsed_result(log.extracted_data_json)
    if parsed is None:
        raise AppException(
            error_code="VALIDATION_ERROR",
            message="No parsed GST verification data is available to save.",
            status_code=400,
        )

    # Update party with GST verification data
    party.gstin = parsed.gstin
    party.gst_verified_status = "VERIFIED"
    party.gst_verified_at = datetime.now(timezone.utc)
    party.gst_verified_by = saved_by
    party.gst_verification_source = log.source_url
    party.gst_legal_name = parsed.legal_name
    party.gst_trade_name = parsed.trade_name
    party.gst_status = parsed.status
    party.gst_taxpayer_type = parsed.taxpayer_type
    party.gst_registration_date = parsed.registration_date
    party.gst_additional_addresses = parsed.additional_addresses
    party.gst_raw_snapshot = parsed.raw_snapshot

    if remarks:
        log.remarks = remarks

    return parsed


def _apply_step_to_log(
    log: GSTVerificationLog,
    *,
    gstin: str,
    step: GSTVerificationClientStep,
) -> GSTWorkflowState:
    result: ParsedGSTResult | None = None
    log_status = _normalize_log_status(step.state)

    extracted_data: dict[str, Any] = {
        "gstin": gstin,
        "session_context": step.session_context,
        "challenge_text": step.challenge_text,
        "portal_state": step.state,
    }

    if step.result_snapshot is not None:
        try:
            result = parse_result_snapshot(
                gstin=gstin,
                snapshot=step.result_snapshot,
            )
        except Exception:
            log_status = GSTVerificationLogStatus.PARSE_FAILED
        else:
            result_dict: dict[str, Any] = {
                "gstin": result.gstin,
                "legal_name": result.legal_name,
                "trade_name": result.trade_name,
                "status": result.status,
                "taxpayer_type": result.taxpayer_type,
                "registration_date": result.registration_date.isoformat() if result.registration_date else None,
                "cancellation_date": result.cancellation_date.isoformat() if result.cancellation_date else None,
                "constitution": result.constitution,
                "state_jurisdiction": result.state_jurisdiction,
                "central_jurisdiction": result.central_jurisdiction,
                "principal_address": result.principal_address,
                "additional_addresses": result.additional_addresses,
                "nature_of_business": result.nature_of_business,
                "einvoice_status": result.einvoice_status,
                "raw_snapshot": result.raw_snapshot,
            }
            if _has_meaningful_result(result):
                extracted_data["result"] = result_dict
            else:
                log_status = GSTVerificationLogStatus.PARSE_FAILED
                extracted_data["result"] = result_dict
                extracted_data["parse_failure_reason"] = (
                    "Portal response did not contain structured GST taxpayer data."
                )

    log.status = log_status.value
    log.source_url = step.source_url
    log.remarks = step.remarks
    log.extracted_data_json = extracted_data
    log.response_snapshot = _serialize_snapshot(step.result_snapshot)

    return GSTWorkflowState(
        log=log,
        verification_state=step.state,
        challenge_text=step.challenge_text,
        result=result if log_status == GSTVerificationLogStatus.SUCCESS else None,
        can_resume=log_status == GSTVerificationLogStatus.CAPTCHA_REQUIRED,
        can_save=(
            log_status == GSTVerificationLogStatus.SUCCESS
            and result is not None
            and log.party_id is not None
        ),
    )


def _normalize_log_status(state: str) -> GSTVerificationLogStatus:
    normalized = state.strip().upper()
    if normalized in {GSTVerificationLogStatus.SUCCESS.value, "VERIFIED", "ACTIVE"}:
        return GSTVerificationLogStatus.SUCCESS
    if normalized == GSTVerificationLogStatus.CAPTCHA_REQUIRED.value:
        return GSTVerificationLogStatus.CAPTCHA_REQUIRED
    if normalized == GSTVerificationLogStatus.PARSE_FAILED.value:
        return GSTVerificationLogStatus.PARSE_FAILED
    return GSTVerificationLogStatus.FAILED


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


def _read_parsed_result(payload: dict[str, Any] | None) -> ParsedGSTResult | None:
    if not payload:
        return None
    raw_result = payload.get("result")
    if not isinstance(raw_result, dict):
        return None
    return parse_result_snapshot(
        gstin=str(raw_result.get("gstin") or "").strip(),
        snapshot=raw_result.get("raw_snapshot") or raw_result,
    )


def _has_meaningful_result(result: ParsedGSTResult) -> bool:
    return any(
        (
            bool(result.raw_snapshot),
            result.legal_name,
            result.trade_name,
            result.status,
            result.registration_date,
            result.cancellation_date,
            result.constitution,
            result.state_jurisdiction,
            result.central_jurisdiction,
            result.principal_address,
            result.einvoice_status,
            bool(result.nature_of_business),
        )
    )
