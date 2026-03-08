from sqlalchemy import String, func, or_
from sqlalchemy.sql.elements import ColumnElement

from app.models.inventory import InventoryLedger


def opening_entry_predicate() -> ColumnElement[bool]:
    """Match both canonical and legacy opening-stock ledger markers."""
    reason_upper = func.upper(func.cast(InventoryLedger.reason, String))
    ref_type_upper = func.upper(func.coalesce(InventoryLedger.ref_type, ""))
    return or_(
        reason_upper.in_(("OPENING_STOCK", "OPENING")),
        ref_type_upper == "OPENING",
    )
