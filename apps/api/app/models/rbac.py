from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Permission(Base):
    __tablename__ = "permissions"
    __table_args__ = (
        UniqueConstraint("code", name="uq_permissions_code"),
        Index("ix_permissions_module", "module"),
        Index("ix_permissions_action", "action"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    module: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    code: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    role_permissions = relationship(
        "RolePermission",
        back_populates="permission",
        cascade="all, delete-orphan",
        overlaps="roles,permissions",
    )
    roles = relationship(
        "Role",
        secondary="role_permissions",
        back_populates="permissions",
        overlaps="role_permissions,permission,users,user_roles",
    )


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = (
        Index("ix_user_roles_role_id", "role_id"),
    )

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), primary_key=True)

    user = relationship(
        "User",
        back_populates="user_roles",
        overlaps="roles,users",
    )
    role = relationship(
        "Role",
        back_populates="user_roles",
        overlaps="roles,users",
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (
        Index("ix_role_permissions_permission_id", "permission_id"),
    )

    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), primary_key=True)
    permission_id: Mapped[int] = mapped_column(ForeignKey("permissions.id"), primary_key=True)

    role = relationship(
        "Role",
        back_populates="role_permissions",
        overlaps="roles,permissions",
    )
    permission = relationship(
        "Permission",
        back_populates="role_permissions",
        overlaps="roles,permissions",
    )
