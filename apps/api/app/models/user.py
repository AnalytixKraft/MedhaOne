from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_auth_provider", "auth_provider"),
        Index("ix_users_external_subject", "external_subject", unique=True),
        Index("ix_users_organization_slug", "organization_slug"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    auth_provider: Mapped[str] = mapped_column(String(32), default="LOCAL", nullable=False)
    external_subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    organization_slug: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id"), nullable=True)

    role = relationship("Role", back_populates="primary_users", foreign_keys=[role_id])
    user_roles = relationship(
        "UserRole",
        back_populates="user",
        cascade="all, delete-orphan",
        overlaps="roles,users",
    )
    roles = relationship(
        "Role",
        secondary="user_roles",
        back_populates="users",
        overlaps="user_roles,role,primary_users",
    )
    login_audits = relationship("LoginAudit", back_populates="user")
    audit_logs = relationship("AuditLog", back_populates="user")

    @property
    def effective_roles(self) -> list:
        seen_role_ids: set[int] = set()
        roles = []

        if self.role is not None and self.role.id not in seen_role_ids:
            roles.append(self.role)
            seen_role_ids.add(self.role.id)

        for role in self.roles:
            if role.id not in seen_role_ids:
                roles.append(role)
                seen_role_ids.add(role.id)

        return roles

    @property
    def permissions(self) -> list[str]:
        codes: set[str] = set()
        for role in self.effective_roles:
            for permission in role.permissions:
                codes.add(permission.code)
        return sorted(codes)
