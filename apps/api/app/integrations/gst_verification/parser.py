from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from html import unescape
from typing import Any


@dataclass(slots=True)
class ParsedGSTResult:
    gstin: str
    legal_name: str | None
    trade_name: str | None
    status: str | None
    taxpayer_type: str | None
    registration_date: date | None
    cancellation_date: date | None
    constitution: str | None
    state_jurisdiction: str | None
    central_jurisdiction: str | None
    principal_address: str | None
    additional_addresses: str | None
    nature_of_business: list[str] | None
    einvoice_status: str | None
    raw_snapshot: dict[str, Any]


def parse_result_snapshot(
    *,
    gstin: str,
    snapshot: str | dict[str, Any],
) -> ParsedGSTResult:
    if isinstance(snapshot, dict):
        payload = snapshot
    else:
        payload = _parse_snapshot_text(snapshot)

    # GST portal JSON uses abbreviated field names
    legal_name = _as_optional_text(
        payload.get("lgnm") or payload.get("legal_name")
    )
    trade_name = _as_optional_text(
        payload.get("tradeNam") or payload.get("trade_name")
    )
    status = _as_optional_text(payload.get("sts") or payload.get("status"))
    taxpayer_type = _as_optional_text(payload.get("dty") or payload.get("taxpayer_type"))
    reg_date = _parse_date(payload.get("rgdt") or payload.get("registration_date"))
    cancellation_date = _parse_date(payload.get("cxdt") or payload.get("cancellation_date"))
    constitution = _as_optional_text(payload.get("ctb") or payload.get("constitution"))
    state_jurisdiction = _as_optional_text(
        payload.get("stj") or payload.get("state_jurisdiction")
    )
    central_jurisdiction = _as_optional_text(
        payload.get("ctj") or payload.get("central_jurisdiction")
    )
    einvoice_status = _as_optional_text(
        payload.get("einvoiceStatus") or payload.get("einvoice_status")
    )

    # Principal address — may be nested dict or flat string
    principal_address = _extract_address(
        payload.get("pradr") or payload.get("principal_address")
    )
    additional_addresses = _as_optional_text(payload.get("additional_addresses"))

    # Nature of business — list of strings
    nba_raw = payload.get("nba") or payload.get("nature_of_business")
    nature_of_business: list[str] | None = None
    if isinstance(nba_raw, list):
        nature_of_business = [str(x) for x in nba_raw if x]
    elif isinstance(nba_raw, str) and nba_raw.strip():
        nature_of_business = [nba_raw.strip()]

    return ParsedGSTResult(
        gstin=str(payload.get("gstin") or gstin).strip().upper(),
        legal_name=legal_name,
        trade_name=trade_name,
        status=status,
        taxpayer_type=taxpayer_type,
        registration_date=reg_date,
        cancellation_date=cancellation_date,
        constitution=constitution,
        state_jurisdiction=state_jurisdiction,
        central_jurisdiction=central_jurisdiction,
        principal_address=principal_address,
        additional_addresses=additional_addresses,
        nature_of_business=nature_of_business,
        einvoice_status=einvoice_status,
        raw_snapshot=payload,
    )


def _parse_snapshot_text(snapshot: str) -> dict[str, Any]:
    normalized = snapshot.strip()
    if not normalized:
        return {}
    try:
        parsed = json.loads(normalized)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    # Try HTML label extraction as fallback
    html_pairs = _extract_html_label_pairs(normalized)
    if html_pairs:
        return html_pairs
    return {}


def _extract_html_label_pairs(value: str) -> dict[str, Any]:
    stripped = re.sub(r"\s+", " ", unescape(value))
    pairs: dict[str, Any] = {}
    field_patterns = [
        ("lgnm", re.compile(r"legal\s*name[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE)),
        ("tradeNam", re.compile(r"trade\s*name[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE)),
        ("sts", re.compile(r"status[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE)),
        ("gstin", re.compile(r"gstin[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE)),
        ("rgdt", re.compile(r"registration\s*date[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE)),
        ("ctb", re.compile(r"constitution[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE)),
        ("stj", re.compile(r"state\s*jurisdiction[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE)),
    ]
    for key, pattern in field_patterns:
        match = pattern.search(stripped)
        if match:
            pairs[key] = match.group(1).strip()
    return pairs


def _extract_address(pradr: Any) -> str | None:
    if pradr is None:
        return None
    if isinstance(pradr, str):
        return pradr.strip() or None
    if isinstance(pradr, dict):
        # The GST portal nested address object
        adr = pradr.get("adr") or pradr.get("addr")
        if adr:
            return str(adr).strip() or None
        # Build from components
        parts = []
        for field in ("bno", "bnm", "flno", "st", "loc", "dst", "stcd", "pncd"):
            val = _as_optional_text(pradr.get(field))
            if val:
                parts.append(val)
        return ", ".join(parts) if parts else None
    return None


def _parse_date(value: Any) -> date | None:
    text = _as_optional_text(value)
    if not text:
        return None
    # GST portal typically returns DD/MM/YYYY
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _as_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None
