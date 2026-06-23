from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import (
    DrugLicenseVerifiedStatus,
    GSTVerifiedStatus,
    PartyType,
)


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
    drug_license_verified_status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=DrugLicenseVerifiedStatus.NOT_VERIFIED.value,
        server_default=DrugLicenseVerifiedStatus.NOT_VERIFIED.value,
    )
    drug_license_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    drug_license_verified_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    drug_license_verification_source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    drug_license_holder_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    drug_license_valid_upto: Mapped[date | None] = mapped_column(Date, nullable=True)
    drug_license_state: Mapped[str | None] = mapped_column(String(120), nullable=True)
    drug_license_raw_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Second (optional) drug licence — a company may hold up to two licences.
    drug_license_2_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    drug_license_2_verified_status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=DrugLicenseVerifiedStatus.NOT_VERIFIED.value,
        server_default=DrugLicenseVerifiedStatus.NOT_VERIFIED.value,
    )
    drug_license_2_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    drug_license_2_verified_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    drug_license_2_verification_source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    drug_license_2_holder_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    drug_license_2_valid_upto: Mapped[date | None] = mapped_column(Date, nullable=True)
    drug_license_2_state: Mapped[str | None] = mapped_column(String(120), nullable=True)
    drug_license_2_raw_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # GST portal verification fields
    gst_verified_status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=GSTVerifiedStatus.NOT_VERIFIED.value,
        server_default=GSTVerifiedStatus.NOT_VERIFIED.value,
    )
    gst_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    gst_verified_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    gst_verification_source: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gst_legal_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gst_trade_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gst_status: Mapped[str | None] = mapped_column(String(60), nullable=True)
    gst_taxpayer_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    gst_registration_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    gst_additional_addresses: Mapped[str | None] = mapped_column(Text, nullable=True)
    gst_raw_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
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

    drug_license_verifier = relationship("User", foreign_keys=[drug_license_verified_by])
    drug_license_2_verifier = relationship("User", foreign_keys=[drug_license_2_verified_by])
    drug_license_verification_logs = relationship(
        "DrugLicenseVerificationLog",
        back_populates="party",
        cascade="all, delete-orphan",
    )
    gst_verifier = relationship("User", foreign_keys=[gst_verified_by])
    gst_verification_logs = relationship(
        "GSTVerificationLog",
        back_populates="party",
        cascade="all, delete-orphan",
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
