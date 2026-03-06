from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.core.tenant import validate_tenant_header_or_raise
from app.core.tenant import bootstrap_schema_compatibility
from app.models import base  # noqa: F401
from app.routers import TENANT_SCOPED_PREFIXES, public_router, tenant_router
from app.services.rbac import bootstrap_rbac_if_ready

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    bootstrap_rbac_if_ready()
    bootstrap_schema_compatibility()
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)


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


@app.middleware("http")
async def guard_tenant_context(request: Request, call_next):
    if request.url.path.startswith(TENANT_SCOPED_PREFIXES):
        try:
            validate_tenant_header_or_raise(request.headers.get("authorization"))
        except AppException as exc:
            return await app_exception_handler(request, exc)

    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public_router)
app.include_router(tenant_router)
