from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.role import Role
from app.models.user import User

settings = get_settings()


def seed_admin(db: Session) -> None:
    admin_role = db.query(Role).filter(Role.name == "admin").first()
    if not admin_role:
        admin_role = Role(name="admin", is_active=True)
        db.add(admin_role)
        db.commit()
        db.refresh(admin_role)

    admin_user = db.query(User).filter(User.email == settings.default_admin_email).first()
    if admin_user:
        print(f"Admin user already exists: {settings.default_admin_email}")
        return

    user = User(
        email=settings.default_admin_email,
        full_name="System Administrator",
        hashed_password=get_password_hash(settings.default_admin_password),
        is_active=True,
        role_id=admin_role.id,
    )
    db.add(user)
    db.commit()
    print(f"Created admin user: {settings.default_admin_email}")


def run() -> None:
    db = SessionLocal()
    try:
        seed_admin(db)
    finally:
        db.close()


if __name__ == "__main__":
    run()
