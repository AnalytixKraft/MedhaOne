from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.role import Role
from app.models.user import User


def _user_query(db: Session):
    return db.query(User).options(
        joinedload(User.role).selectinload(Role.permissions),
        selectinload(User.roles).selectinload(Role.permissions),
    )


def get_user_by_email(db: Session, email: str) -> User | None:
    return (
        _user_query(db)
        .filter(User.auth_provider == "LOCAL")
        .filter(User.email == email)
        .first()
    )


def get_user_by_external_subject(db: Session, external_subject: str) -> User | None:
    return (
        _user_query(db)
        .filter(User.external_subject == external_subject)
        .first()
    )


def get_any_user_by_email(db: Session, email: str) -> User | None:
    return (
        _user_query(db)
        .filter(User.email == email)
        .first()
    )


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return (
        _user_query(db)
        .filter(User.id == user_id)
        .first()
    )
