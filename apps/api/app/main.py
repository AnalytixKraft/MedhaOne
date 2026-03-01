from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import inventory, masters, purchase, reports, test_tools, users
from app.api.routes.auth import router as auth_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.health import router as health_router
from app.core.config import get_settings
from app.core.exceptions import AppException
from app.models import base  # noqa: F401
from app.services.rbac import bootstrap_rbac_if_ready

settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.1.0")


@app.on_event("startup")
def bootstrap_rbac() -> None:
    bootstrap_rbac_if_ready()


@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    _ = request
    content = {
        "error_code": exc.error_code,
        "message": exc.message,
    }
    if exc.details is not None:
        content["details"] = exc.details

    return JSONResponse(status_code=exc.status_code, content=content)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(masters.router, prefix="/masters", tags=["Masters"])
app.include_router(inventory.router, prefix="/inventory", tags=["Inventory"])
app.include_router(purchase.router, prefix="/purchase", tags=["Purchase"])
app.include_router(reports.router, prefix="/reports", tags=["Reports"])
app.include_router(users.router, prefix="/users", tags=["Users"])
app.include_router(test_tools.router)
