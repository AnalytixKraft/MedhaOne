from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import InventoryReason, InventoryTxnType


class InventoryBaseRequest(BaseModel):
    warehouse_id: int
    product_id: int
    batch_id: int
    reason: InventoryReason
    ref_type: str | None = None
    ref_id: str | None = None


class InventoryInRequest(InventoryBaseRequest):
    qty: Decimal = Field(gt=0)
    reason: InventoryReason = InventoryReason.PURCHASE_GRN


class InventoryOutRequest(InventoryBaseRequest):
    qty: Decimal = Field(gt=0)
    reason: InventoryReason = InventoryReason.SALES_DISPATCH


class InventoryAdjustRequest(BaseModel):
    warehouse_id: int
    product_id: int
    batch_id: int
    delta_qty: Decimal
    reason: InventoryReason = InventoryReason.STOCK_ADJUSTMENT


class InventoryActionResponse(BaseModel):
    ledger_id: int
    txn_type: InventoryTxnType
    qty: Decimal
    qty_on_hand: Decimal
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
