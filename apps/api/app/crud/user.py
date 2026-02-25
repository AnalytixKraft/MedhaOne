from sqlalchemy.orm import Session, joinedload

from app.models.user import User


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).options(joinedload(User.role)).filter(User.email == email).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).options(joinedload(User.role)).filter(User.id == user_id).first()
