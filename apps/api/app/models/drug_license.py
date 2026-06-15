from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class DrugLicenseVerificationLog(Base):
    __tablename__ = "drug_license_verification_logs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    party_id: Mapped[int | None] = mapped_column(ForeignKey("parties.id"), nullable=True, index=True)
    drug_license_number: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    requested_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    extracted_data_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    response_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    party = relationship("Party", back_populates="drug_license_verification_logs")
    requester = relationship("User")
