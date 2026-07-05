import os

from knx_telegram_store.buffered import BufferedPostgresStore, BufferedSqliteStore
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Uses env var or defaults to the docker-compose settings
# Database connection settings
DB_USER = os.getenv("POSTGRES_USER", "knxuser")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", "knxpassword")
DB_NAME = os.getenv("POSTGRES_DB", "knx_analyzer")
DB_HOST = os.getenv("POSTGRES_HOST", "localhost")
DB_PORT = os.getenv("POSTGRES_PORT", "5432")

# Prioritize full DATABASE_URL, otherwise build it from components
DATABASE_URL = os.getenv("DATABASE_URL", f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}")

engine = create_async_engine(DATABASE_URL, echo=False)

_SQLITE_PREFIX = "sqlite+aiosqlite:///"

if DATABASE_URL.startswith(_SQLITE_PREFIX):
    # Strip the URL scheme to get the file path (absolute paths keep their leading /)
    _db_path = DATABASE_URL[len(_SQLITE_PREFIX):]
    store = BufferedSqliteStore(_db_path, flush_interval=1.0)
else:
    store = BufferedPostgresStore(DATABASE_URL, flush_interval=1.0)

AsyncSessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def get_store():
    return store
