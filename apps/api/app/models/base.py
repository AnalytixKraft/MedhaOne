from app.core.database import Base
from app.models.audit import AuditLog
from app.models.batch import Batch
from app.models.brand import Brand
from app.models.category import Category
from app.models.company_settings import CompanySettings
from app.models.inventory import InventoryLedger, StockSummary
from app.models.login_audit import LoginAudit
from app.models.party import Party
from app.models.product import Product
from app.models.purchase import (
    GRN,
    GRNBatchLine,
    GRNLine,
    PurchaseCreditNote,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseReturn,
    PurchaseReturnLine,
)
from app.models.rbac import Permission, RolePermission, UserRole
from app.models.role import Role
from app.models.stock_operations import StockAdjustment, StockCorrection
from app.models.stock_provenance import StockSourceProvenance
from app.models.tax_rate import TaxRate
from app.models.user import User
from app.models.warehouse import Warehouse

# Import model classes so SQLAlchemy metadata is fully registered for Alembic.
__all__ = [
    "Base",
    "User",
    "Role",
    "Party",
    "Warehouse",
    "Product",
    "Batch",
    "Brand",
    "Category",
    "CompanySettings",
    "AuditLog",
    "PurchaseOrder",
    "PurchaseOrderLine",
    "GRN",
    "GRNBatchLine",
    "GRNLine",
    "PurchaseReturn",
    "PurchaseReturnLine",
    "PurchaseCreditNote",
    "Permission",
    "UserRole",
    "RolePermission",
    "LoginAudit",
    "InventoryLedger",
    "StockSummary",
    "StockCorrection",
    "StockAdjustment",
    "StockSourceProvenance",
    "TaxRate",
]
