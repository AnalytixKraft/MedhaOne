from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.user import User
from app.schemas.purchase_bill import PurchaseBillListResponse, PurchaseBillResponse, PurchaseBillUpdate
from app.services.purchase_bill import (
    cancel_purchase_bill,
    get_document_attachment,
    get_purchase_bill,
    list_purchase_bills,
    post_purchase_bill,
    update_purchase_bill,
    upload_purchase_bill,
    verify_purchase_bill,
)

router = APIRouter()


@router.get("/purchase-bills", response_model=PurchaseBillListResponse)
def list_purchase_bill_route(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase_bill:view")),
) -> PurchaseBillListResponse:
    _ = current_user
    return PurchaseBillListResponse(items=list_purchase_bills(db))


@router.get("/purchase-bills/{bill_id}", response_model=PurchaseBillResponse)
def get_purchase_bill_route(
    bill_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase_bill:view")),
) -> PurchaseBillResponse:
    _ = current_user
    return get_purchase_bill(db, bill_id)


@router.post(
    "/purchase-bills/upload",
    response_model=PurchaseBillResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_purchase_bill_route(
    file: UploadFile = File(...),
    warehouse_id: int | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase_bill:upload")),
) -> PurchaseBillResponse:
    file_bytes = await file.read()
    return upload_purchase_bill(
        db,
        file_name=file.filename or "invoice",
        file_type=file.content_type or "application/octet-stream",
        file_bytes=file_bytes,
        created_by=current_user.id,
        warehouse_id=warehouse_id,
    )


@router.patch("/purchase-bills/{bill_id}", response_model=PurchaseBillResponse)
def update_purchase_bill_route(
    bill_id: int,
    payload: PurchaseBillUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase_bill:create")),
) -> PurchaseBillResponse:
    return update_purchase_bill(db, bill_id, payload, updated_by=current_user.id)


@router.post("/purchase-bills/{bill_id}/verify", response_model=PurchaseBillResponse)
def verify_purchase_bill_route(
    bill_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase_bill:verify")),
) -> PurchaseBillResponse:
    return verify_purchase_bill(db, bill_id, verified_by=current_user.id)


@router.post("/purchase-bills/{bill_id}/post", response_model=PurchaseBillResponse)
def post_purchase_bill_route(
    bill_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase_bill:post")),
) -> PurchaseBillResponse:
    return post_purchase_bill(db, bill_id, posted_by=current_user.id)


@router.post("/purchase-bills/{bill_id}/cancel", response_model=PurchaseBillResponse)
def cancel_purchase_bill_route(
    bill_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase_bill:create")),
) -> PurchaseBillResponse:
    return cancel_purchase_bill(db, bill_id, cancelled_by=current_user.id)


@router.get("/purchase-bills/attachments/{attachment_id}")
def get_purchase_bill_attachment_route(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase_bill:view")),
) -> FileResponse:
    _ = current_user
    attachment = get_document_attachment(db, attachment_id)
    return FileResponse(
        path=Path(attachment.storage_path),
        media_type=attachment.file_type,
        filename=attachment.file_name,
    )
