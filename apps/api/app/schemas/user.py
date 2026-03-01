from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class RoleRead(BaseModel):
    id: int
    name: str
    description: str | None = None
    is_system: bool = False

    model_config = {"from_attributes": True}


class UserRead(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    is_active: bool
    is_superuser: bool
    last_login_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    role: RoleRead | None = None
    roles: list[RoleRead] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    items: list[UserRead]


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str
    is_active: bool = True
    is_superuser: bool = False
    role_ids: list[int] = Field(min_length=1)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8)
    full_name: str | None = None
    is_active: bool | None = None
    is_superuser: bool | None = None


class UserRoleAssignmentRequest(BaseModel):
    role_ids: list[int] = Field(default_factory=list)


class UserRolesResponse(BaseModel):
    user_id: int
    roles: list[RoleRead]
    permissions: list[str]
