import csv
import io
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import String, cast, func, or_, select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.models.audit import AuditLog
from app.models.user import User
from app.schemas.audit import AuditLogDetailResponse, AuditLogListResponse, RecordHistoryResponse
from app.services.audit import changed_fields

router = APIRouter()

_LEGACY_INVENTORY_ENTITY_TYPES = {
    "BATCH",
    "INVENTORY",
    "OPENING_STOCK",
    "PRODUCT",
    "STOCK_ADJUSTMENT",
    "STOCK_CORRECTION",
    "WAREHOUSE",
}
_LEGACY_PURCHASE_ENTITY_TYPES = {
    "GRN",
    "PO",
    "PURCHASE_CREDIT_NOTE",
    "PURCHASE_ORDER",
    "PURCHASE_RETURN",
}
_LEGACY_SETTINGS_ENTITY_TYPES = {"COMPANY_SETTINGS", "SETTINGS", "TAX", "TAX_RATE"}
_LEGACY_USERS_ENTITY_TYPES = {"ROLE", "USER"}
_EXCLUDED_AUDIT_ACTIONS = {
    "LOGIN",
    "LOGOUT",
    "OPEN",
    "CLOSE",
    "ORG_USER_LOGIN",
    "ORG_USER_LOGOUT",
    "SESSION_OPEN",
    "SESSION_CLOSE",
}


def _current_schema_name(db: Session) -> str:
    tenant_schema = db.info.get("tenant_schema")
    if isinstance(tenant_schema, str) and tenant_schema:
        return tenant_schema
    return str(db.execute(text("SELECT current_schema()")).scalar_one())


def _table_has_column(db: Session, schema_name: str, table_name: str, column_name: str) -> bool:
    return (
        db.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = :schema_name
                  AND table_name = :table_name
                  AND column_name = :column_name
                """
            ),
            {
                "schema_name": schema_name,
                "table_name": table_name,
                "column_name": column_name,
            },
        ).scalar_one_or_none()
        is not None
    )


def _uses_legacy_audit_schema(db: Session) -> bool:
    schema_name = _current_schema_name(db)
    return _table_has_column(db, schema_name, "audit_logs", "actor_user_id") and not _table_has_column(
        db, schema_name, "audit_logs", "performed_by"
    )


def _coerce_text(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def _coerce_metadata(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _legacy_module(metadata: dict[str, Any], *, action: str, entity_type: str) -> str:
    explicit = metadata.get("module")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()

    normalized_type = entity_type.upper()
    normalized_action = action.upper()
    if normalized_type in _LEGACY_PURCHASE_ENTITY_TYPES:
        return "Purchase"
    if normalized_type in _LEGACY_INVENTORY_ENTITY_TYPES:
        return "Inventory"
    if normalized_type in _LEGACY_SETTINGS_ENTITY_TYPES:
        return "Settings"
    if normalized_type in _LEGACY_USERS_ENTITY_TYPES or normalized_action.startswith("ORG_USER_"):
        return "Users"
    return "Legacy Audit"


def _legacy_summary(metadata: dict[str, Any], action: str) -> str:
    summary = metadata.get("summary")
    if isinstance(summary, str) and summary.strip():
        return summary.strip()
    return action.replace("_", " ").title()


def _build_audit_row(log: AuditLog) -> AuditLogDetailResponse:
    return AuditLogDetailResponse(
        id=str(log.id),
        timestamp=log.timestamp,
        user_id=str(log.performed_by),
        user_name=log.user.full_name if log.user else None,
        module=log.module,
        action=log.action,
        entity_type=log.entity_type,
        entity_id=str(log.entity_id),
        summary=log.summary,
        reason=log.reason,
        remarks=log.remarks,
        source_screen=log.source_screen,
        source_reference=log.source_reference,
        changed_fields=changed_fields(log.before_snapshot, log.after_snapshot),
        before_snapshot=log.before_snapshot,
        after_snapshot=log.after_snapshot,
        metadata=log.metadata_json,
    )


def _build_legacy_audit_row(row: Mapping[str, Any]) -> AuditLogDetailResponse:
    metadata = _coerce_metadata(row.get("metadata"))
    before_snapshot = metadata.get("before_snapshot")
    after_snapshot = metadata.get("after_snapshot")
    if not isinstance(before_snapshot, dict):
        before_snapshot = None
    if not isinstance(after_snapshot, dict):
        after_snapshot = None

    action = _coerce_text(row.get("action")) or "UNKNOWN"
    entity_type = (_coerce_text(row.get("target_type")) or "UNKNOWN").upper()
    user_id = _coerce_text(metadata.get("performed_by")) or _coerce_text(row.get("actor_user_id"))
    return AuditLogDetailResponse(
        id=_coerce_text(row.get("id")) or "",
        timestamp=row["created_at"],
        user_id=user_id,
        user_name=_coerce_text(metadata.get("user_name") or metadata.get("performed_by_name") or metadata.get("email")),
        module=_legacy_module(metadata, action=action, entity_type=entity_type),
        action=action,
        entity_type=entity_type,
        entity_id=_coerce_text(row.get("target_id")) or "",
        summary=_legacy_summary(metadata, action),
        reason=_coerce_text(metadata.get("reason")),
        remarks=_coerce_text(metadata.get("remarks")),
        source_screen=_coerce_text(metadata.get("source_screen")),
        source_reference=_coerce_text(metadata.get("source_reference")),
        changed_fields=changed_fields(before_snapshot, after_snapshot),
        before_snapshot=before_snapshot,
        after_snapshot=after_snapshot,
        metadata=metadata,
    )


def _matches_search(row: AuditLogDetailResponse, search: str | None) -> bool:
    normalized = (search or "").strip().lower()
    if not normalized:
        return True
    haystacks = (
        row.module,
        row.action,
        row.entity_type,
        row.entity_id,
        row.summary or "",
        row.reason or "",
        row.remarks or "",
        row.source_reference or "",
        row.user_name or "",
        row.user_id or "",
    )
    return any(normalized in value.lower() for value in haystacks if isinstance(value, str))


def _is_visible_audit_action(action: str | None) -> bool:
    normalized = (action or "").strip().upper()
    return normalized not in _EXCLUDED_AUDIT_ACTIONS


def _is_visible_audit_row(row: AuditLogDetailResponse) -> bool:
    return _is_visible_audit_action(row.action)


def _filter_legacy_rows(
    rows: list[AuditLogDetailResponse],
    *,
    module: str | None,
    search: str | None,
) -> list[AuditLogDetailResponse]:
    filtered = rows
    if module:
        normalized_module = module.strip().lower()
        filtered = [row for row in filtered if row.module.lower() == normalized_module]
    filtered = [row for row in filtered if _is_visible_audit_row(row)]
    if search:
        filtered = [row for row in filtered if _matches_search(row, search)]
    return filtered


def _apply_audit_filters(
    stmt,
    *,
    user_id: str | None,
    module: str | None,
    action: str | None,
    entity_type: str | None,
    entity_id: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    search: str | None,
):
    if user_id:
        stmt = stmt.where(cast(AuditLog.performed_by, String) == user_id)
    if module:
        stmt = stmt.where(AuditLog.module == module)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    else:
        stmt = stmt.where(AuditLog.action.not_in(_EXCLUDED_AUDIT_ACTIONS))
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type.upper())
    if entity_id:
        stmt = stmt.where(cast(AuditLog.entity_id, String) == entity_id)
    if date_from is not None:
        stmt = stmt.where(AuditLog.timestamp >= date_from)
    if date_to is not None:
        stmt = stmt.where(AuditLog.timestamp <= date_to)
    if search:
        normalized = search.strip().lower()
        if normalized:
            pattern = f"%{normalized}%"
            stmt = stmt.where(
                or_(
                    func.lower(func.coalesce(AuditLog.module, "")).like(pattern),
                    func.lower(func.coalesce(AuditLog.action, "")).like(pattern),
                    func.lower(func.coalesce(AuditLog.entity_type, "")).like(pattern),
                    func.lower(func.coalesce(AuditLog.summary, "")).like(pattern),
                    func.lower(func.coalesce(AuditLog.reason, "")).like(pattern),
                    func.lower(func.coalesce(AuditLog.remarks, "")).like(pattern),
                    func.lower(func.coalesce(AuditLog.source_reference, "")).like(pattern),
                    cast(AuditLog.entity_id, String).like(pattern),
                )
            )
    return stmt


def _fetch_legacy_audit_rows(
    db: Session,
    *,
    user_id: str | None,
    module: str | None,
    action: str | None,
    entity_type: str | None,
    entity_id: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    search: str | None,
) -> list[AuditLogDetailResponse]:
    filters: list[str] = []
    params: dict[str, Any] = {}

    if user_id:
        filters.append("CAST(actor_user_id AS TEXT) = :user_id")
        params["user_id"] = user_id
    if action:
        filters.append("action = :action")
        params["action"] = action
    if entity_type:
        filters.append("UPPER(target_type) = :entity_type")
        params["entity_type"] = entity_type.upper()
    if entity_id:
        filters.append("CAST(target_id AS TEXT) = :entity_id")
        params["entity_id"] = entity_id
    if date_from is not None:
        filters.append("created_at >= :date_from")
        params["date_from"] = date_from
    if date_to is not None:
        filters.append("created_at <= :date_to")
        params["date_to"] = date_to

    where_sql = f"WHERE {' AND '.join(filters)}" if filters else ""
    result = db.execute(
        text(
            f"""
            SELECT id, actor_user_id, action, target_type, target_id, metadata, created_at
            FROM audit_logs
            {where_sql}
            ORDER BY created_at DESC, id DESC
            """
        ),
        params,
    ).mappings()
    rows = [_build_legacy_audit_row(row) for row in result]
    return _filter_legacy_rows(rows, module=module, search=search)


def _write_audit_csv(rows: list[AuditLogDetailResponse]) -> Response:
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(
        [
            "timestamp",
            "user",
            "module",
            "action",
            "entity_type",
            "entity_id",
            "summary",
            "reason",
            "remarks",
            "source_screen",
            "source_reference",
        ]
    )
    for row in rows:
        writer.writerow(
            [
                row.timestamp.isoformat(),
                row.user_name or row.user_id or "",
                row.module,
                row.action,
                row.entity_type,
                row.entity_id,
                row.summary or "",
                row.reason or "",
                row.remarks or "",
                row.source_screen or "",
                row.source_reference or "",
            ]
        )

    return Response(
        content=stream.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit-trail.csv"'},
    )


@router.get("/audit-trail", response_model=AuditLogListResponse)
def list_audit_logs(
    user_id: str | None = None,
    module: str | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    search: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("audit:view")),
) -> AuditLogListResponse:
    _ = current_user
    if _uses_legacy_audit_schema(db):
        rows = _fetch_legacy_audit_rows(
            db,
            user_id=user_id,
            module=module,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            date_from=date_from,
            date_to=date_to,
            search=search,
        )
        total = len(rows)
        start = (page - 1) * page_size
        end = start + page_size
        return AuditLogListResponse(total=total, page=page, page_size=page_size, data=rows[start:end])

    base_stmt = select(AuditLog).outerjoin(User, User.id == AuditLog.performed_by)
    base_stmt = _apply_audit_filters(
        base_stmt,
        user_id=user_id,
        module=module,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        date_from=date_from,
        date_to=date_to,
        search=search,
    )
    total = int(db.execute(select(func.count()).select_from(base_stmt.order_by(None).subquery())).scalar_one())
    logs = db.execute(
        base_stmt.order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).scalars()
    data = [_build_audit_row(log) for log in logs]
    return AuditLogListResponse(total=total, page=page, page_size=page_size, data=data)


@router.get("/audit-trail/export")
def export_audit_logs(
    user_id: str | None = None,
    module: str | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("audit:view")),
) -> Response:
    _ = current_user
    if _uses_legacy_audit_schema(db):
        rows = _fetch_legacy_audit_rows(
            db,
            user_id=user_id,
            module=module,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            date_from=date_from,
            date_to=date_to,
            search=search,
        )
        return _write_audit_csv(rows)

    stmt = select(AuditLog).outerjoin(User, User.id == AuditLog.performed_by)
    stmt = _apply_audit_filters(
        stmt,
        user_id=user_id,
        module=module,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        date_from=date_from,
        date_to=date_to,
        search=search,
    )
    rows = [_build_audit_row(log) for log in db.execute(stmt.order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())).scalars()]
    return _write_audit_csv(rows)


@router.get("/audit-trail/{audit_log_id}", response_model=AuditLogDetailResponse)
def get_audit_log_detail(
    audit_log_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("audit:view")),
) -> AuditLogDetailResponse:
    _ = current_user
    if _uses_legacy_audit_schema(db):
        row = db.execute(
            text(
                """
                SELECT id, actor_user_id, action, target_type, target_id, metadata, created_at
                FROM audit_logs
                WHERE CAST(id AS TEXT) = :audit_log_id
                """
            ),
            {"audit_log_id": audit_log_id},
        ).mappings().first()
        if row is None:
            raise AppException(
                error_code="NOT_FOUND",
                message="Audit log not found",
                status_code=status.HTTP_404_NOT_FOUND,
            )
        result = _build_legacy_audit_row(row)
        if not _is_visible_audit_row(result):
            raise AppException(
                error_code="NOT_FOUND",
                message="Audit log not found",
                status_code=status.HTTP_404_NOT_FOUND,
            )
        return result

    try:
        numeric_id = int(audit_log_id)
    except ValueError as error:
        raise AppException(
            error_code="NOT_FOUND",
            message="Audit log not found",
            status_code=status.HTTP_404_NOT_FOUND,
        ) from error

    log = (
        db.query(AuditLog)
        .outerjoin(User, User.id == AuditLog.performed_by)
        .filter(AuditLog.id == numeric_id)
        .first()
    )
    if log is None:
        raise AppException(
            error_code="NOT_FOUND",
            message="Audit log not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    if not _is_visible_audit_action(log.action):
        raise AppException(
            error_code="NOT_FOUND",
            message="Audit log not found",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return _build_audit_row(log)


@router.get("/history/{entity_type}/{entity_id}", response_model=RecordHistoryResponse)
def get_record_history(
    entity_type: str,
    entity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("audit:view")),
) -> RecordHistoryResponse:
    _ = current_user
    if _uses_legacy_audit_schema(db):
        rows = _fetch_legacy_audit_rows(
            db,
            user_id=None,
            module=None,
            action=None,
            entity_type=entity_type,
            entity_id=str(entity_id),
            date_from=None,
            date_to=None,
            search=None,
        )
        return RecordHistoryResponse(
            entity_type=entity_type.upper(),
            entity_id=entity_id,
            entries=rows,
        )

    logs = (
        db.query(AuditLog)
        .outerjoin(User, User.id == AuditLog.performed_by)
        .filter(AuditLog.entity_type == entity_type.upper(), AuditLog.entity_id == entity_id)
        .order_by(AuditLog.timestamp.desc(), AuditLog.id.desc())
        .all()
    )
    return RecordHistoryResponse(
        entity_type=entity_type.upper(),
        entity_id=entity_id,
        entries=[_build_audit_row(log) for log in logs if _is_visible_audit_action(log.action)],
    )
