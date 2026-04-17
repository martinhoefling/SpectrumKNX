from sqlalchemy import Column, String, Double, Table, MetaData, Integer
from sqlalchemy.dialects.postgresql import JSONB, BYTEA, TIMESTAMP

metadata = MetaData()

# We use SQLAlchemy Core tables rather than Declarative Base because TimescaleDB 
# hypertables don't require primary keys and we don't need the ORM entity tracking
# overhead for pure time-series inserts.
telegrams_table = Table(
    'telegrams',
    metadata,
    Column('timestamp', TIMESTAMP(timezone=True), nullable=False),
    Column('source_address', String(20), nullable=False),
    Column('target_address', String(20), nullable=False),
    Column('telegram_type', String(50), nullable=False),
    Column('dpt', String(20), nullable=True),
    Column('dpt_main', Integer, nullable=True),
    Column('dpt_sub', Integer, nullable=True),
    Column('raw_data', BYTEA, nullable=True),
    Column('value_numeric', Double, nullable=True),
    Column('value_json', JSONB, nullable=True)
)
