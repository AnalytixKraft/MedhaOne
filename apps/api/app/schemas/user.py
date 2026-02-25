from pydantic import BaseModel, EmailStr


class RoleRead(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class UserRead(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    is_active: bool
    role: RoleRead

    model_config = {"from_attributes": True}
