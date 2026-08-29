#!/usr/bin/env bash
# End-to-end test for compose-migrate.sh (#432).
#
# Drives the real docker CLI against real volumes, because that is what the
# script does — the container-level suite cannot cover it. Seeds a PostgreSQL 15
# volume shaped like a Spectrum KNX store (TimescaleDB hypertable with
# compressed and uncompressed chunks, a text index, UTF-8 values, four tables),
# migrates it, and verifies both that the target is complete and that the source
# came through untouched.
#
# Volumes are prefixed and refused if they already exist, so this can never
# disturb a real deployment.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PREFIX="${PREFIX:-spectrumknx_migtest}"
SRC_VOL="${PREFIX}_src"
TGT_VOL="${PREFIX}_tgt"
SEED_CTR="${PREFIX}_seed"
CHECK_CTR="${PREFIX}_check"
SOURCE_MAJOR="${SOURCE_MAJOR:-15}"
TARGET_MAJOR="${TARGET_MAJOR:-18}"
PGUSER_="knxuser"
PGPASS_="knxpassword"
PGDB_="knx_analyzer"
ROWS="${ROWS:-15000}"

say()  { echo; echo "=== $* ==="; }
fail() { echo "TEST FAILURE: $*" >&2; exit 1; }

cleanup() {
    docker rm -f "$SEED_CTR" "$CHECK_CTR" >/dev/null 2>&1 || true
    docker volume rm -f "$SRC_VOL" "$TGT_VOL" >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v docker >/dev/null || fail "docker is not on PATH."

for v in "$SRC_VOL" "$TGT_VOL"; do
    docker volume inspect "$v" >/dev/null 2>&1 && fail "volume '$v' already exists; remove it before running the test."
done

# Where a given major expects its volume mounted (PostgreSQL 18 relocated PGDATA).
mount_for() { if [ "$1" -ge 18 ] 2>/dev/null; then echo /var/lib/postgresql; else echo /var/lib/postgresql/data; fi; }

start_pg() {
    local name="$1" major="$2" volume="$3"
    docker run -d --name "$name" \
        -e POSTGRES_USER="$PGUSER_" -e POSTGRES_PASSWORD="$PGPASS_" -e POSTGRES_DB="$PGDB_" \
        -v "$volume:$(mount_for "$major")" \
        "timescale/timescaledb:latest-pg${major}" >/dev/null
    local i
    for i in $(seq 1 90); do
        # TCP, not the socket: the entrypoint's temporary init server answers on
        # the socket and then shuts down.
        docker exec "$name" pg_isready -h 127.0.0.1 -U "$PGUSER_" -d "$PGDB_" >/dev/null 2>&1 && return 0
        sleep 2
    done
    docker logs "$name" 2>&1 | tail -20 >&2
    fail "PostgreSQL $major did not become ready."
}

q() { docker exec "$1" psql -U "$PGUSER_" -d "$PGDB_" -X -A -t -v ON_ERROR_STOP=1 -c "$2"; }

say "Seeding a PostgreSQL $SOURCE_MAJOR store"
docker volume create "$SRC_VOL" >/dev/null
start_pg "$SEED_CTR" "$SOURCE_MAJOR" "$SRC_VOL"
docker exec -i "$SEED_CTR" psql -U "$PGUSER_" -d "$PGDB_" -q -v ON_ERROR_STOP=1 <<SQL
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE string_lookup (id serial PRIMARY KEY, value text NOT NULL);
CREATE INDEX string_lookup_value_idx ON string_lookup(value);
CREATE TABLE store_metadata (key text PRIMARY KEY, value text);
CREATE TABLE last_ga_telegrams (destination_id int PRIMARY KEY, timestamp timestamptz NOT NULL, value_numeric double precision);
CREATE TABLE telegrams (id bigserial, timestamp timestamptz NOT NULL, source_id int NOT NULL,
                        destination_id int NOT NULL, value_numeric double precision, raw_data text);
CREATE INDEX telegrams_ts_idx ON telegrams(timestamp);
SELECT create_hypertable('telegrams','timestamp',chunk_time_interval=>INTERVAL '1 day');
INSERT INTO string_lookup(value) SELECT 'ga-'||g||'-Ätzend-Straße' FROM generate_series(1,300) g;
INSERT INTO store_metadata VALUES ('schema_version','7');
INSERT INTO last_ga_telegrams SELECT g, now()-(g||' minutes')::interval, g::float FROM generate_series(1,120) g;
INSERT INTO telegrams(timestamp,source_id,destination_id,value_numeric,raw_data)
  SELECT now()-(g||' minutes')::interval,(g%50)+1,(g%200)+1,(g%1000)::float/10,md5(g::text)
  FROM generate_series(1,$ROWS) g;
ALTER TABLE telegrams SET (timescaledb.compress,
    timescaledb.compress_orderby='timestamp DESC', timescaledb.compress_segmentby='destination_id');
SQL
compressed="$(q "$SEED_CTR" "SELECT count(*) FROM (SELECT compress_chunk(c) FROM show_chunks('telegrams', older_than=>INTERVAL '2 days') c) s")"
[ "$compressed" -ge 1 ] || fail "seed produced no compressed chunks — the test would not prove anything"
echo "compressed chunks: $compressed"

SRC_TELEGRAMS="$(q "$SEED_CTR" "SELECT count(*) FROM telegrams")"
SRC_SUM="$(q "$SEED_CTR" "SELECT round(sum(value_numeric)::numeric,3) FROM telegrams")"
SRC_LOOKUP="$(q "$SEED_CTR" "SELECT count(*) FROM string_lookup")"
SRC_LAST="$(q "$SEED_CTR" "SELECT count(*) FROM last_ga_telegrams")"
SRC_META="$(q "$SEED_CTR" "SELECT count(*) FROM store_metadata")"
echo "source: telegrams=$SRC_TELEGRAMS sum=$SRC_SUM lookup=$SRC_LOOKUP last=$SRC_LAST meta=$SRC_META"
docker rm -f "$SEED_CTR" >/dev/null

say "Running compose-migrate.sh ($SOURCE_MAJOR -> $TARGET_MAJOR)"
cd "$REPO_ROOT"
SOURCE_VOLUME="$SRC_VOL" TARGET_VOLUME="$TGT_VOL" TARGET_MAJOR="$TARGET_MAJOR" \
    POSTGRES_USER="$PGUSER_" POSTGRES_PASSWORD="$PGPASS_" POSTGRES_DB="$PGDB_" \
    bash packaging/pg-migrate/compose-migrate.sh

say "Verifying the migrated volume"
start_pg "$CHECK_CTR" "$TARGET_MAJOR" "$TGT_VOL"
got_major="$(q "$CHECK_CTR" "SELECT current_setting('server_version_num')::int/10000")"
[ "$got_major" = "$TARGET_MAJOR" ] || fail "migrated cluster is PostgreSQL $got_major, expected $TARGET_MAJOR"

for check in "telegrams:$SRC_TELEGRAMS" "string_lookup:$SRC_LOOKUP" "last_ga_telegrams:$SRC_LAST" "store_metadata:$SRC_META"; do
    t="${check%%:*}"; expected="${check##*:}"
    actual="$(q "$CHECK_CTR" "SELECT count(*) FROM $t")"
    [ "$actual" = "$expected" ] || fail "$t: expected $expected rows, got $actual"
    echo "  $t: $actual rows OK"
done

actual_sum="$(q "$CHECK_CTR" "SELECT round(sum(value_numeric)::numeric,3) FROM telegrams")"
[ "$actual_sum" = "$SRC_SUM" ] || fail "values changed: $SRC_SUM -> $actual_sum"

# Indexes must come across, or the app would never add them: create_all skips
# tables that already exist.
idx="$(q "$CHECK_CTR" "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename IN ('telegrams','string_lookup')")"
[ "$idx" -ge 3 ] || fail "expected the indexes to survive, found $idx"

# Sequences must be past the copied ids, or the first insert collides.
seq_pos="$(q "$CHECK_CTR" "SELECT last_value FROM telegrams_id_seq")"
[ "$seq_pos" -ge "$SRC_TELEGRAMS" ] || fail "telegrams_id_seq at $seq_pos, behind $SRC_TELEGRAMS rows"

# Non-ASCII must survive the COPY round trip.
umlaut="$(q "$CHECK_CTR" "SELECT value FROM string_lookup WHERE value LIKE 'ga-7-%'")"
[ "$umlaut" = "ga-7-Ätzend-Straße" ] || fail "UTF-8 mangled: '$umlaut'"

docker exec "$CHECK_CTR" psql -U "$PGUSER_" -d "$PGDB_" -q -v ON_ERROR_STOP=1 \
    -c "INSERT INTO telegrams(timestamp,source_id,destination_id) VALUES (now(),1,1)" \
    || fail "cannot write to the migrated database"
echo "  indexes=$idx sequence=$seq_pos utf8 OK write OK"
docker rm -f "$CHECK_CTR" >/dev/null

say "Verifying the source volume is untouched"
start_pg "$CHECK_CTR" "$SOURCE_MAJOR" "$SRC_VOL"
src_major="$(q "$CHECK_CTR" "SELECT current_setting('server_version_num')::int/10000")"
src_rows="$(q "$CHECK_CTR" "SELECT count(*) FROM telegrams")"
src_sum="$(q "$CHECK_CTR" "SELECT round(sum(value_numeric)::numeric,3) FROM telegrams")"
src_comp="$(q "$CHECK_CTR" "SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name='telegrams' AND is_compressed")"
[ "$src_major" = "$SOURCE_MAJOR" ] || fail "source is now PostgreSQL $src_major"
[ "$src_rows" = "$SRC_TELEGRAMS" ] || fail "source row count changed: $SRC_TELEGRAMS -> $src_rows"
[ "$src_sum" = "$SRC_SUM" ]        || fail "source values changed"
[ "$src_comp" = "$compressed" ]    || fail "source compressed chunks changed: $compressed -> $src_comp"
echo "  PostgreSQL $src_major, $src_rows rows, $src_comp compressed chunks — unchanged"

say "PASS — migrated $SRC_TELEGRAMS telegrams PG$SOURCE_MAJOR -> PG$TARGET_MAJOR, source intact"
