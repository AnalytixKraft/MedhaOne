from __future__ import annotations

import re

from app.core.exceptions import AppException

ORG_SLUG_PATTERN = re.compile(r"^[a-z0-9_]+$")


def validate_org_slug(raw_slug: str) -> str:
    slug = raw_slug.strip()
    if not slug or not ORG_SLUG_PATTERN.fullmatch(slug):
        raise AppException(
            error_code="INVALID_ORG",
            message="Organization slug is invalid",
            status_code=400,
        )
    return slug


def build_tenant_schema_name(org_slug: str) -> str:
    return f"org_{validate_org_slug(org_slug)}"


def quote_schema_name(schema_name: str) -> str:
    if schema_name == "public":
        return '"public"'
    if not ORG_SLUG_PATTERN.fullmatch(schema_name.replace("org_", "", 1)) or not schema_name.startswith("org_"):
        raise AppException(
            error_code="INVALID_SCHEMA",
            message="Unsafe tenant schema name",
            status_code=400,
        )
    return f'"{schema_name}"'
