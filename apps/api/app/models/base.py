from app.core.database import Base
from app.models.audit import AuditLog
from app.models.batch import Batch
from app.models.inventory import InventoryLedger, StockSummary
from app.models.login_audit import LoginAudit
from app.models.party import Party
from app.models.product import Product
from app.models.purchase import GRN, GRNLine, PurchaseOrder, PurchaseOrderLine
from app.models.rbac import Permission, RolePermission, UserRole
from app.models.role import Role
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
    "AuditLog",
    "PurchaseOrder",
    "PurchaseOrderLine",
    "GRN",
    "GRNLine",
    "Permission",
    "UserRole",
    "RolePermission",
    "LoginAudit",
    "InventoryLedger",
    "StockSummary",
]
