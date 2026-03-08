from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditLogRow(BaseModel):
    id: str
    timestamp: datetime
    user_id: str | None = None
    user_name: str | None = None
    module: str
    action: str
    entity_type: str
    entity_id: str
    summary: str | None = None
    reason: str | None = None
    remarks: str | None = None
    source_screen: str | None = None
    source_reference: str | None = None
    changed_fields: list[str] = []


class AuditLogListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    data: list[AuditLogRow]


class AuditLogDetailResponse(AuditLogRow):
    before_snapshot: dict[str, Any] | None = None
    after_snapshot: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


class RecordHistoryResponse(BaseModel):
    entity_type: str
    entity_id: int
    entries: list[AuditLogDetailResponse]
