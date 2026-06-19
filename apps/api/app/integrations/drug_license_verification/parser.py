from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from html import unescape
from typing import Any


@dataclass(slots=True)
class ParsedDrugLicenseResult:
    license_number: str
    holder_name: str | None
    status: str | None
    valid_upto: date | None
    authority: str | None
    state: str | None
    raw_snapshot: dict[str, Any]


def parse_result_snapshot(
    *,
    license_number: str,
    snapshot: str | dict[str, Any],
) -> ParsedDrugLicenseResult:
    if isinstance(snapshot, dict):
        payload = snapshot
    else:
        payload = _parse_snapshot_text(snapshot)

    return ParsedDrugLicenseResult(
        license_number=str(
            payload.get("license_number")
            or payload.get("str_ondls_licence_no")
            or license_number
        ).strip(),
        holder_name=_as_optional_text(
            payload.get("holder_name")
            or payload.get("firm_name")
            or payload.get("institute_name")
        ),
        status=_as_optional_text(payload.get("status") or payload.get("licence_status")),
        valid_upto=_parse_date(
            payload.get("valid_upto")
            or payload.get("validity_date")
            or payload.get("dt_curr_validity_date")
        ),
        authority=_as_optional_text(payload.get("authority")),
        state=_as_optional_text(payload.get("state")),
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

    html_pairs = _extract_html_label_pairs(normalized)
    if html_pairs:
        return html_pairs

    return _extract_text_pairs(normalized)


def _extract_html_label_pairs(value: str) -> dict[str, Any]:
    stripped = re.sub(r"\s+", " ", unescape(value))
    pairs: dict[str, Any] = {}
    patterns = [
        re.compile(
            r"(?:license|licence)\s*(?:number|no\.?)[:\s]*</[^>]+>\s*<[^>]+>([^<]+)",
            re.IGNORECASE,
        ),
        re.compile(r"holder\s*(?:name)?[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE),
        re.compile(r"firm\s*name[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE),
        re.compile(r"status[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE),
        re.compile(r"valid(?:ity)?\s*(?:upto|up to|date)?[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE),
        re.compile(r"authority[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE),
        re.compile(r"state[:\s]*</[^>]+>\s*<[^>]+>([^<]+)", re.IGNORECASE),
    ]
    keys = [
        "license_number",
        "holder_name",
        "firm_name",
        "status",
        "valid_upto",
        "authority",
        "state",
    ]
    for key, pattern in zip(keys, patterns, strict=True):
        match = pattern.search(stripped)
        if match:
            pairs[key] = match.group(1).strip()
    return pairs


def _extract_text_pairs(value: str) -> dict[str, Any]:
    normalized = re.sub(r"<[^>]+>", "\n", value)
    normalized = unescape(normalized)
    pairs: dict[str, Any] = {}
    alias_map = {
        "license number": "license_number",
        "licence number": "license_number",
        "license no": "license_number",
        "licence no": "license_number",
        "holder name": "holder_name",
        "firm name": "firm_name",
        "status": "status",
        "valid upto": "valid_upto",
        "validity date": "valid_upto",
        "authority": "authority",
        "state": "state",
    }
    for line in normalized.splitlines():
        if ":" not in line:
            continue
        raw_key, raw_value = line.split(":", 1)
        key = re.sub(r"\s+", " ", raw_key).strip().lower()
        mapped_key = alias_map.get(key)
        if mapped_key:
            pairs[mapped_key] = raw_value.strip()
    return pairs


def _parse_date(value: Any) -> date | None:
    text = _as_optional_text(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d %b %Y", "%d %B %Y", "%d-%b-%Y", "%d-%B-%Y"):
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
