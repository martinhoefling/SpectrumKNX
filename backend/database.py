import os

from knx_telegram_store.backends.sqlite import SqliteStore
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

# standalone (default): own KNX daemon writes telegrams to our own database.
# external-readonly: companion mode — read a sqlite store owned and written by
# another process (e.g. Home Assistant's KNX integration); no daemon, no writes.
STORE_MODE = os.getenv("STORE_MODE", "standalone")
READ_ONLY = STORE_MODE == "external-readonly"

_SQLITE_PREFIX = "sqlite+aiosqlite:///"

if DATABASE_URL.startswith(_SQLITE_PREFIX):
    # Strip the URL scheme to get the file path (absolute paths keep their leading /)
    _db_path = DATABASE_URL[len(_SQLITE_PREFIX):]
    if READ_ONLY:
        store = SqliteStore(_db_path, read_only=True)
        # The raw engine (used by /api/statistics) must also open read-only
        DATABASE_URL = f"{_SQLITE_PREFIX}file:{_db_path}?mode=ro&uri=true"
    else:
        store = BufferedSqliteStore(_db_path, flush_interval=1.0)
elif READ_ONLY:
    raise RuntimeError("STORE_MODE=external-readonly requires a sqlite DATABASE_URL")
else:
    store = BufferedPostgresStore(DATABASE_URL, flush_interval=1.0)

engine = create_async_engine(DATABASE_URL, echo=False)

AsyncSessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def get_store():
    return store
