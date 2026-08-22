#!/usr/bin/env bash
# End-to-end test for the PostgreSQL major-version migration (#432).
#
# Builds a realistic PostgreSQL 15 cluster — TimescaleDB hypertable, compressed
# and uncompressed chunks, a collation-sensitive text index, and the extension
# deliberately created at an older version than the packages ship — migrates it
# to PostgreSQL 18, and verifies nothing was lost.
#
# Runs inside the pg-migrate image; see run-tests.sh.

set -euo pipefail

DATADIR="${DATADIR:-/var/lib/postgresql/data}"
SOURCE_MAJOR="${SOURCE_MAJOR:-15}"
TARGET_MAJOR="${TARGET_MAJOR:-18}"
# Older than the newest the PG15 package provides, so the migration has to walk
# the extension forward before pg_upgrade can hand it to PostgreSQL 18.
TS_START_VERSION="${TS_START_VERSION:-2.26.4}"
ROWS="${ROWS:-20000}"

OLD_BIN="/usr/lib/postgresql/$SOURCE_MAJOR/bin"
NEW_BIN="/usr/lib/postgresql/$TARGET_MAJOR/bin"
SOCK="/tmp/pgsock"
mkdir -p "$SOCK"
[ "$(id -u)" = "0" ] && chown postgres:postgres "$SOCK"

# The test must work both unprivileged (compose-style) and as root
# (add-on-style), so its own setup drops privileges the same way migrate.sh does.
if [ "$(id -u)" = "0" ]; then
    if command -v s6-setuidgid >/dev/null 2>&1; then
        AS_PG="s6-setuidgid postgres"
    else
        AS_PG="setpriv --reuid=postgres --regid=postgres --init-groups --"
    fi
else
    AS_PG=""
fi
# shellcheck disable=SC2086 # AS_PG is a command prefix and must word-split
run_pg() { if [ -n "$AS_PG" ]; then $AS_PG "$@"; else "$@"; fi; }

# The add-on image generates no extra locales, so real add-on clusters are
# C-collation; the standalone image has en_US.UTF-8. Use whichever exists — the
# point is that migrate.sh carries the old cluster's locale over, not that any
# particular locale is used.
if locale -a 2>/dev/null | grep -qiE '^en_US\.utf-?8$'; then
    TEST_LOCALE="en_US.UTF-8"
else
    TEST_LOCALE="C"
fi
echo "Using locale: $TEST_LOCALE"

say()  { echo; echo "=== $* ==="; }
fail() { echo "TEST FAILURE: $*" >&2; exit 1; }

say "Creating a PostgreSQL $SOURCE_MAJOR cluster"
rm -rf "$DATADIR" "${DATADIR}.old-$SOURCE_MAJOR" "${DATADIR}.new-$TARGET_MAJOR"
mkdir -p "$DATADIR"
[ "$(id -u)" = "0" ] && chown postgres:postgres "$DATADIR"
run_pg "$OLD_BIN/initdb" -D "$DATADIR" --encoding=UTF8 --lc-collate="$TEST_LOCALE" --lc-ctype="$TEST_LOCALE" >/dev/null
echo "shared_preload_libraries = 'timescaledb'" >> "$DATADIR/postgresql.conf"
echo "host all all 127.0.0.1/32 trust" >> "$DATADIR/pg_hba.conf"
run_pg "$OLD_BIN/pg_ctl" -D "$DATADIR" -w -o "-c listen_addresses='' -c unix_socket_directories='$SOCK'" start >/dev/null

psql_old() { run_pg "$OLD_BIN/psql" -h "$SOCK" -U postgres -X -v ON_ERROR_STOP=1 "$@"; }

say "Seeding Spectrum KNX-shaped data (TimescaleDB $TS_START_VERSION)"
psql_old -d postgres -q -c "CREATE DATABASE spectrum_knx"
psql_old -d spectrum_knx -q -c "CREATE EXTENSION timescaledb VERSION '$TS_START_VERSION'"

psql_old -d spectrum_knx -q <<SQL
CREATE TABLE string_lookup (
    id      SERIAL PRIMARY KEY,
    value   TEXT NOT NULL
);
-- Collation-sensitive index: the thing that would break under a musl/glibc mix.
CREATE INDEX string_lookup_value_idx ON string_lookup (value);

CREATE TABLE telegrams (
    id              BIGSERIAL,
    timestamp       TIMESTAMPTZ NOT NULL,
    source_id       INTEGER NOT NULL,
    destination_id  INTEGER NOT NULL,
    payload         JSONB,
    value_numeric   DOUBLE PRECISION,
    raw_data        TEXT
);
SELECT create_hypertable('telegrams', 'timestamp', chunk_time_interval => INTERVAL '1 day');

INSERT INTO string_lookup (value)
SELECT 'ga-' || g || '-Ätzend-Straße' FROM generate_series(1, 500) g;

INSERT INTO telegrams (timestamp, source_id, destination_id, payload, value_numeric, raw_data)
SELECT now() - (g || ' minutes')::interval,
       (g % 50) + 1,
       (g % 200) + 1,
       jsonb_build_object('raw', g),
       (g % 1000)::float / 10,
       md5(g::text)
FROM generate_series(1, $ROWS) g;
SQL

say "Enabling compression and compressing older chunks"
psql_old -d spectrum_knx -q -c "ALTER TABLE telegrams SET (timescaledb.compress, timescaledb.compress_orderby = 'timestamp DESC', timescaledb.compress_segmentby = 'destination_id')"
COMPRESSED=$(psql_old -d spectrum_knx -A -t -c "SELECT count(*) FROM (SELECT compress_chunk(c) FROM show_chunks('telegrams', older_than => INTERVAL '2 days') c) s")
echo "compressed chunks: $COMPRESSED"
[ "$COMPRESSED" -ge 1 ] || fail "test setup did not produce any compressed chunks"

# Baseline
BEFORE_TELEGRAMS=$(psql_old -d spectrum_knx -A -t -c "SELECT count(*) FROM telegrams")
BEFORE_LOOKUP=$(psql_old -d spectrum_knx -A -t -c "SELECT count(*) FROM string_lookup")
BEFORE_SUM=$(psql_old -d spectrum_knx -A -t -c "SELECT round(sum(value_numeric)::numeric, 3) FROM telegrams")
BEFORE_TS=$(psql_old -d spectrum_knx -A -t -c "SELECT extversion FROM pg_extension WHERE extname='timescaledb'")
BEFORE_CHUNKS=$(psql_old -d spectrum_knx -A -t -c "SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name='telegrams'")
echo "before: telegrams=$BEFORE_TELEGRAMS lookup=$BEFORE_LOOKUP sum=$BEFORE_SUM ts=$BEFORE_TS chunks=$BEFORE_CHUNKS"
[ "$BEFORE_TS" = "$TS_START_VERSION" ] || fail "expected TimescaleDB $TS_START_VERSION, got $BEFORE_TS"

run_pg "$OLD_BIN/pg_ctl" -D "$DATADIR" -m fast -w stop >/dev/null

say "Running the migration"
DATADIR="$DATADIR" TARGET_MAJOR="$TARGET_MAJOR" /usr/local/bin/pg-migrate

say "Verifying the migrated cluster"
[ "$(cat "$DATADIR/PG_VERSION")" = "$TARGET_MAJOR" ] || fail "data directory is not PostgreSQL $TARGET_MAJOR"
[ -d "${DATADIR}.old-${SOURCE_MAJOR}" ] || fail "the original cluster was not preserved"

run_pg "$NEW_BIN/pg_ctl" -D "$DATADIR" -w -o "-c listen_addresses='' -c unix_socket_directories='$SOCK'" start >/dev/null
psql_new() { run_pg "$NEW_BIN/psql" -h "$SOCK" -U postgres -X -v ON_ERROR_STOP=1 "$@"; }

AFTER_TELEGRAMS=$(psql_new -d spectrum_knx -A -t -c "SELECT count(*) FROM telegrams")
AFTER_LOOKUP=$(psql_new -d spectrum_knx -A -t -c "SELECT count(*) FROM string_lookup")
AFTER_SUM=$(psql_new -d spectrum_knx -A -t -c "SELECT round(sum(value_numeric)::numeric, 3) FROM telegrams")
AFTER_TS=$(psql_new -d spectrum_knx -A -t -c "SELECT extversion FROM pg_extension WHERE extname='timescaledb'")
AFTER_CHUNKS=$(psql_new -d spectrum_knx -A -t -c "SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name='telegrams'")
IS_HYPER=$(psql_new -d spectrum_knx -A -t -c "SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_name='telegrams'")
STILL_COMPRESSED=$(psql_new -d spectrum_knx -A -t -c "SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name='telegrams' AND is_compressed")
echo "after:  telegrams=$AFTER_TELEGRAMS lookup=$AFTER_LOOKUP sum=$AFTER_SUM ts=$AFTER_TS chunks=$AFTER_CHUNKS compressed=$STILL_COMPRESSED"

[ "$AFTER_TELEGRAMS" = "$BEFORE_TELEGRAMS" ] || fail "telegram row count changed: $BEFORE_TELEGRAMS -> $AFTER_TELEGRAMS"
[ "$AFTER_LOOKUP" = "$BEFORE_LOOKUP" ]       || fail "string_lookup row count changed: $BEFORE_LOOKUP -> $AFTER_LOOKUP"
[ "$AFTER_SUM" = "$BEFORE_SUM" ]             || fail "numeric values changed: $BEFORE_SUM -> $AFTER_SUM"
[ "$AFTER_CHUNKS" = "$BEFORE_CHUNKS" ]       || fail "chunk count changed: $BEFORE_CHUNKS -> $AFTER_CHUNKS"
[ "$IS_HYPER" = "1" ]                        || fail "telegrams is no longer a hypertable"
[ "$STILL_COMPRESSED" -ge 1 ]                || fail "compressed chunks did not survive the migration"
[ "$AFTER_TS" != "$BEFORE_TS" ]              || fail "TimescaleDB extension was not updated (still $AFTER_TS)"

# Reading through a compressed chunk must still work.
OLDEST=$(psql_new -d spectrum_knx -A -t -c "SELECT count(*) FROM telegrams WHERE timestamp < now() - INTERVAL '2 days'")
[ "$OLDEST" -ge 1 ] || fail "no rows readable from the compressed range"

# The collation-sensitive index must still return correct results.
IDX=$(psql_new -d spectrum_knx -A -t -c "SELECT count(*) FROM string_lookup WHERE value LIKE 'ga-1-%'")
[ "$IDX" -ge 1 ] || fail "text index lookup returned nothing"

# Writes must work after the upgrade.
psql_new -d spectrum_knx -q -c "INSERT INTO telegrams (timestamp, source_id, destination_id) VALUES (now(), 1, 1)"

run_pg "$NEW_BIN/pg_ctl" -D "$DATADIR" -m fast -w stop >/dev/null

say "PASS — migrated $BEFORE_TELEGRAMS telegrams from PG$SOURCE_MAJOR/TS$BEFORE_TS to PG$TARGET_MAJOR/TS$AFTER_TS"
