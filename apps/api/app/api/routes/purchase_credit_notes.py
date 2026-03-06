from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.exceptions import AppException
from app.core.permissions import require_permission
from app.models.purchase import PurchaseCreditNote
from app.models.user import User
from app.schemas.purchase import PurchaseCreditNoteResponse

router = APIRouter()


@router.get("", response_model=list[PurchaseCreditNoteResponse])
def list_purchase_credit_notes(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase_credit:view")),
) -> list[PurchaseCreditNoteResponse]:
    _ = current_user
    return (
        db.query(PurchaseCreditNote)
        .order_by(PurchaseCreditNote.created_at.desc(), PurchaseCreditNote.id.desc())
        .all()
    )


@router.get("/{credit_note_id}", response_model=PurchaseCreditNoteResponse)
def get_purchase_credit_note(
    credit_note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("purchase_credit:view")),
) -> PurchaseCreditNoteResponse:
    _ = current_user
    record = (
        db.query(PurchaseCreditNote)
        .filter(PurchaseCreditNote.id == credit_note_id)
        .first()
    )
    if not record:
        raise AppException(
            error_code="NOT_FOUND",
            message="Purchase credit note not found",
            status_code=404,
        )
    return record
