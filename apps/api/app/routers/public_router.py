from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.test_tools import router as test_tools_router

PUBLIC_SCOPED_PREFIXES = ("/health", "/auth", "/test")

public_router = APIRouter()
public_router.include_router(health_router)
public_router.include_router(auth_router)
public_router.include_router(test_tools_router)
