from fastapi import APIRouter, Depends

from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.inventory import router as inventory_router
from app.api.routes.masters import router as masters_router
from app.api.routes.purchase import router as purchase_router
from app.api.routes.reports import router as reports_router
from app.api.routes.settings import router as settings_router
from app.api.routes.users import router as users_router
from app.core.tenant import ensure_tenant_db_context

TENANT_SCOPED_PREFIXES = (
    "/dashboard",
    "/masters",
    "/inventory",
    "/purchase",
    "/reports",
    "/settings",
    "/users",
)

tenant_router = APIRouter(dependencies=[Depends(ensure_tenant_db_context)])
tenant_router.include_router(dashboard_router)
tenant_router.include_router(masters_router, prefix="/masters", tags=["Masters"])
tenant_router.include_router(inventory_router, prefix="/inventory", tags=["Inventory"])
tenant_router.include_router(purchase_router, prefix="/purchase", tags=["Purchase"])
tenant_router.include_router(reports_router, prefix="/reports", tags=["Reports"])
tenant_router.include_router(settings_router, prefix="/settings", tags=["Settings"])
tenant_router.include_router(users_router, prefix="/users", tags=["Users"])
