from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_permission
from app.models.inventory import StockSummary
from app.models.party import Party
from app.models.product import Product
from app.models.user import User
from app.models.warehouse import Warehouse
from app.schemas.dashboard import DashboardMetrics

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/metrics", response_model=DashboardMetrics)
def get_dashboard_metrics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dashboard:view")),
) -> DashboardMetrics:
    _ = current_user
    total_products = db.query(func.count(Product.id)).scalar() or 0
    total_parties = db.query(func.count(Party.id)).scalar() or 0
    total_warehouses = db.query(func.count(Warehouse.id)).scalar() or 0
    stock_items_count = (
        db.query(func.count(StockSummary.id))
        .filter(StockSummary.qty_on_hand > Decimal("0"))
        .scalar()
        or 0
    )

    return DashboardMetrics(
        total_products=total_products,
        total_parties=total_parties,
        total_warehouses=total_warehouses,
        stock_items_count=stock_items_count,
    )
