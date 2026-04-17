CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE telegrams (
    timestamp TIMESTAMPTZ NOT NULL,
    source_address VARCHAR(20) NOT NULL,
    target_address VARCHAR(20) NOT NULL,
    telegram_type VARCHAR(50) NOT NULL,
    dpt VARCHAR(20),     -- e.g. "5.001"
    dpt_main INTEGER,    -- e.g. 5
    dpt_sub INTEGER,     -- e.g. 1
    raw_data BYTEA,      -- uninterpreted bytes
    value_numeric DOUBLE PRECISION, -- populated if the decoded value is a number (for easy charting)
    value_json JSONB     -- populated if the decoded value is complex (like RGB, Date) or a string
);

-- Convert the table into a TimescaleDB hypertable
-- 'timestamp' is the partitioning column. Defaults to 7-day chunks which is ideal here.
SELECT create_hypertable('telegrams', 'timestamp');

-- Add useful indexes for querying
CREATE INDEX ix_telegrams_target ON telegrams (target_address, timestamp DESC);
CREATE INDEX ix_telegrams_source ON telegrams (source_address, timestamp DESC);
CREATE INDEX ix_telegrams_dpt ON telegrams (dpt_main, dpt_sub, timestamp DESC);
