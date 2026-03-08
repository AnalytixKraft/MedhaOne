from datetime import datetime

from pydantic import BaseModel, EmailStr


class CompanySettingsRead(BaseModel):
    organization_name: str | None = None
    company_name: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    gst_number: str | None = None
    pan_number: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    logo_url: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class CompanySettingsUpdate(BaseModel):
    company_name: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    gst_number: str | None = None
    pan_number: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    logo_url: str | None = None
