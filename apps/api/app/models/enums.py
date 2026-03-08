from enum import Enum


class PartyType(str, Enum):
    CUSTOMER = "CUSTOMER"
    SUPPLIER = "SUPPLIER"
    BOTH = "BOTH"
    MANUFACTURER = "SUPPLIER"
    SUPER_STOCKIST = "SUPPLIER"
    DISTRIBUTOR = "SUPPLIER"
    HOSPITAL = "CUSTOMER"
    PHARMACY = "CUSTOMER"
    RETAILER = "CUSTOMER"
    CONSUMER = "CUSTOMER"


class PartyCategory(str, Enum):
    RETAILER = "RETAILER"
    DISTRIBUTOR = "DISTRIBUTOR"
    STOCKIST = "STOCKIST"
    HOSPITAL = "HOSPITAL"
    PHARMACY = "PHARMACY"
    INSTITUTION = "INSTITUTION"
    OTHER = "OTHER"


class RegistrationType(str, Enum):
    REGISTERED = "REGISTERED"
    UNREGISTERED = "UNREGISTERED"
    COMPOSITION = "COMPOSITION"
    SEZ = "SEZ"
    OTHER = "OTHER"


class OutstandingTrackingMode(str, Enum):
    BILL_WISE = "BILL_WISE"
    FIFO = "FIFO"
    ON_ACCOUNT = "ON_ACCOUNT"


class InventoryTxnType(str, Enum):
    IN = "IN"
    OUT = "OUT"
    ADJUST = "ADJUST"
    TRANSFER = "TRANSFER"


class InventoryReason(str, Enum):
    PURCHASE_GRN = "PURCHASE_GRN"
    SALES_DISPATCH = "SALES_DISPATCH"
    STOCK_ADJUSTMENT = "STOCK_ADJUSTMENT"
    OPENING_STOCK = "OPENING_STOCK"
    STOCK_CORRECTION_OUT = "STOCK_CORRECTION_OUT"
    STOCK_CORRECTION_IN = "STOCK_CORRECTION_IN"


class StockAdjustmentType(str, Enum):
    POSITIVE = "POSITIVE"
    NEGATIVE = "NEGATIVE"


class StockAdjustmentReason(str, Enum):
    STOCK_COUNT_CORRECTION = "STOCK_COUNT_CORRECTION"
    DAMAGED = "DAMAGED"
    EXPIRED = "EXPIRED"
    FOUND_STOCK = "FOUND_STOCK"
    OPENING_BALANCE_FIX = "OPENING_BALANCE_FIX"
    THEFT = "THEFT"
    BREAKAGE = "BREAKAGE"
    OTHER = "OTHER"


class PurchaseOrderStatus(str, Enum):
    DRAFT = "DRAFT"
    APPROVED = "APPROVED"
    PARTIALLY_RECEIVED = "PARTIALLY_RECEIVED"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"


class GrnStatus(str, Enum):
    DRAFT = "DRAFT"
    POSTED = "POSTED"
    CANCELLED = "CANCELLED"


class PurchaseReturnStatus(str, Enum):
    DRAFT = "DRAFT"
    POSTED = "POSTED"
    CANCELLED = "CANCELLED"


class PurchaseCreditNoteStatus(str, Enum):
    GENERATED = "GENERATED"
    ADJUSTED = "ADJUSTED"


class SalesOrderStatus(str, Enum):
    DRAFT = "DRAFT"
    CONFIRMED = "CONFIRMED"
    PARTIALLY_DISPATCHED = "PARTIALLY_DISPATCHED"
    DISPATCHED = "DISPATCHED"
    CANCELLED = "CANCELLED"


class StockReservationStatus(str, Enum):
    ACTIVE = "ACTIVE"
    PARTIALLY_CONSUMED = "PARTIALLY_CONSUMED"
    CONSUMED = "CONSUMED"
    RELEASED = "RELEASED"


class DispatchNoteStatus(str, Enum):
    DRAFT = "DRAFT"
    POSTED = "POSTED"
    CANCELLED = "CANCELLED"


class PurchaseBillStatus(str, Enum):
    DRAFT = "DRAFT"
    VERIFIED = "VERIFIED"
    POSTED = "POSTED"
    CANCELLED = "CANCELLED"


class PurchaseBillExtractionStatus(str, Enum):
    NOT_STARTED = "NOT_STARTED"
    EXTRACTED = "EXTRACTED"
    REVIEWED = "REVIEWED"
    FAILED = "FAILED"
