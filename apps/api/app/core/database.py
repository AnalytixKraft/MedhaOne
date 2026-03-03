from collections.abc import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings
from app.core.tenancy import quote_schema_name

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
IS_POSTGRES = settings.database_url.startswith("postgresql")


if IS_POSTGRES:
    @event.listens_for(engine, "checkout")
    def _reset_search_path_on_checkout(dbapi_connection, _connection_record, _connection_proxy):
        # Every pooled connection starts from the public schema to avoid tenant bleed.
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("SET search_path TO public")
        finally:
            cursor.close()


class Base(DeclarativeBase):
    pass


def set_tenant_search_path(db: Session, schema_name: str) -> None:
    if not IS_POSTGRES:
        return
    db.execute(text(f"SET search_path TO {quote_schema_name(schema_name)}, public"))
    db.info["tenant_schema"] = schema_name


def reset_search_path(db: Session) -> None:
    if not IS_POSTGRES:
        return
    try:
        db.execute(text("SET search_path TO public"))
    except SQLAlchemyError:
        db.rollback()
    finally:
        db.info.pop("tenant_schema", None)


def _session_scope() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        reset_search_path(db)
        db.close()


def get_db():
    yield from _session_scope()


def get_public_db():
    # Distinct dependency callable so auth/public lookups do not share the tenant-bound session.
    yield from _session_scope()
