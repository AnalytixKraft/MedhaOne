from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.services.rbac import ensure_admin_user


def seed_admin(db: Session) -> None:
    user = ensure_admin_user(db)
    print(f"Ensured admin user: {user.email}")


def run() -> None:
    db = SessionLocal()
    try:
        seed_admin(db)
    finally:
        db.close()


if __name__ == "__main__":
    run()
