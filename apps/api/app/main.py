from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.core.tenant import validate_tenant_header_or_raise
from app.integrations.drug_license_verification.client import set_drug_license_verification_client
from app.integrations.drug_license_verification.sfda_client import SFDADrugLicenseVerificationClient
from app.integrations.gst_verification.client import set_gst_verification_client
from app.integrations.gst_verification.gst_portal_client import GSTPortalVerificationClient
from app.integrations.gst_verification.setu_client import SetuGSTVerificationClient
from app.models import base  # noqa: F401
from app.routers import TENANT_SCOPED_PREFIXES, public_router, tenant_router
from app.services.rbac import bootstrap_rbac_if_ready

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    bootstrap_rbac_if_ready()
    if settings.openai_api_key:
        set_drug_license_verification_client(SFDADrugLicenseVerificationClient())

    # Prefer Setu's official GST API when its credentials are configured;
    # otherwise fall back to the (WAF-blocked) portal scraper.
    if settings.setu_client_id and settings.setu_gst_key:
        set_gst_verification_client(SetuGSTVerificationClient())
    elif settings.openai_api_key:
        set_gst_verification_client(GSTPortalVerificationClient())
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
