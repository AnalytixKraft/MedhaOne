from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    primary_users = relationship("User", back_populates="role", foreign_keys="User.role_id")
    user_roles = relationship(
        "UserRole",
        back_populates="role",
        cascade="all, delete-orphan",
        overlaps="users,roles,primary_users",
    )
    users = relationship(
        "User",
        secondary="user_roles",
        back_populates="roles",
        overlaps="user_roles,user,role,primary_users",
    )
    role_permissions = relationship(
        "RolePermission",
        back_populates="role",
        cascade="all, delete-orphan",
        overlaps="permissions,roles",
    )
    permissions = relationship(
        "Permission",
        secondary="role_permissions",
        back_populates="roles",
        overlaps="role_permissions,permission,user_roles,users",
    )
