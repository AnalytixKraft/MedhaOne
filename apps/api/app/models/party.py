from datetime import datetime

from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.enums import OutstandingTrackingMode, PartyCategory, PartyType, RegistrationType


class Party(Base):
    __tablename__ = "parties"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    party_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    party_type: Mapped[str] = mapped_column(String(30), nullable=False, default=PartyType.CUSTOMER.value)
    party_category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    contact_person: Mapped[str | None] = mapped_column(String(255), nullable=True)
    designation: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    whatsapp_no: Mapped[str | None] = mapped_column(String(30), nullable=True)
    office_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    address_line_2: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[str | None] = mapped_column(String(120), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    pincode: Mapped[str | None] = mapped_column(String(10), nullable=True)
    country: Mapped[str | None] = mapped_column(String(120), nullable=True, default="India")
    gstin: Mapped[str | None] = mapped_column(String(15), nullable=True)
    pan_number: Mapped[str | None] = mapped_column(String(10), nullable=True)
    registration_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    drug_license_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    fssai_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    udyam_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    credit_limit: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True, default=Decimal("0.00"))
    payment_terms: Mapped[str | None] = mapped_column(String(255), nullable=True)
    opening_balance: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True, default=Decimal("0.00"))
    outstanding_tracking_mode: Mapped[str | None] = mapped_column(String(30), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @property
    def party_name(self) -> str:
        return self.name

    @party_name.setter
    def party_name(self, value: str) -> None:
        self.name = value

    @property
    def mobile(self) -> str | None:
        return self.phone

    @mobile.setter
    def mobile(self, value: str | None) -> None:
        self.phone = value

    @property
    def address_line_1(self) -> str | None:
        return self.address

    @address_line_1.setter
    def address_line_1(self, value: str | None) -> None:
        self.address = value
