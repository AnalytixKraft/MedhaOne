from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import uuid4

from sqlalchemy.inspection import inspect as sqlalchemy_inspect
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.audit import AuditLog


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    return value


def snapshot_model(instance: Any, *, fields: Iterable[str] | None = None) -> dict[str, Any]:
    mapper = sqlalchemy_inspect(instance.__class__)
    allowed = set(fields) if fields is not None else None
    snapshot: dict[str, Any] = {}
    for column in mapper.columns:
        if allowed is not None and column.key not in allowed:
            continue
        snapshot[column.key] = _json_safe(getattr(instance, column.key))
    return snapshot


def changed_fields(
    before_snapshot: dict[str, Any] | None,
    after_snapshot: dict[str, Any] | None,
) -> list[str]:
    before_snapshot = before_snapshot or {}
    after_snapshot = after_snapshot or {}
    keys = sorted(set(before_snapshot) | set(after_snapshot))
    return [key for key in keys if before_snapshot.get(key) != after_snapshot.get(key)]


def write_audit_log(
    db: Session,
    *,
    module: str,
    action: str,
    entity_type: str,
    entity_id: int,
    performed_by: int,
    summary: str | None = None,
    reason: str | None = None,
    remarks: str | None = None,
    source_screen: str | None = None,
    source_reference: str | None = None,
    before_snapshot: dict[str, Any] | None = None,
    after_snapshot: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditLog | None:
    schema_name = str(db.info.get("tenant_schema") or db.execute(text("SELECT current_schema()")).scalar_one())
    legacy_audit_schema = (
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'audit_logs'
                  AND column_name = 'actor_user_id'
                """
            ),
            {"schema_name": schema_name},
        ).scalar_one_or_none()
        is not None
        and db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = 'audit_logs'
                  AND column_name = 'performed_by'
                """
            ),
            {"schema_name": schema_name},
        ).scalar_one_or_none()
        is None
    )

    if legacy_audit_schema:
        legacy_metadata = _json_safe(metadata) or {}
        if not isinstance(legacy_metadata, dict):
            legacy_metadata = {"metadata": legacy_metadata}
        legacy_metadata.update(
            {
                "module": module,
                "summary": summary,
                "reason": reason,
                "remarks": remarks,
                "source_screen": source_screen,
                "source_reference": source_reference,
                "before_snapshot": _json_safe(before_snapshot),
                "after_snapshot": _json_safe(after_snapshot),
                "performed_by": str(performed_by),
            }
        )
        db.execute(
            text(
                """
                INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at)
                VALUES (:id, :actor_user_id, :action, :target_type, :target_id, CAST(:metadata AS JSONB), NOW())
                """
            ),
            {
                "id": str(uuid4()),
                "actor_user_id": str(performed_by),
                "action": action,
                "target_type": entity_type,
                "target_id": str(entity_id),
                "metadata": json.dumps(legacy_metadata),
            },
        )
        return None

    audit = AuditLog(
        module=module,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        performed_by=performed_by,
        summary=summary,
        reason=reason,
        remarks=remarks,
        source_screen=source_screen,
        source_reference=source_reference,
        before_snapshot=_json_safe(before_snapshot),
        after_snapshot=_json_safe(after_snapshot),
        metadata_json=_json_safe(metadata),
    )
    db.add(audit)
    return audit
