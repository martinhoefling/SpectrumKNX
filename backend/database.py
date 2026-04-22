import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

# Uses env var or defaults to the docker-compose settings
# Database connection settings
DB_USER = os.getenv("POSTGRES_USER", "knxuser")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", "knxpassword")
DB_NAME = os.getenv("POSTGRES_DB", "knx_analyzer")
DB_HOST = os.getenv("POSTGRES_HOST", "localhost")
DB_PORT = os.getenv("POSTGRES_PORT", "5432")

# Prioritize full DATABASE_URL, otherwise build it from components
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)

engine = create_async_engine(DATABASE_URL, echo=False)

AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
