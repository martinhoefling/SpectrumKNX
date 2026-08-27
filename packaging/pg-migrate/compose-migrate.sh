#!/usr/bin/env bash
# Logical PostgreSQL major-version migration for a Docker Compose deployment (#432).
#
# Why logical rather than pg_upgrade: the stock timescale/timescaledb images are
# Alpine/musl and their clusters report lc_collate=en_US.utf8, which musl treats
# as byte ordering while glibc treats as linguistic ordering. Running the
# Debian-based pg_upgrade image against such a cluster would rebuild system
# catalog indexes under glibc collation, to be served afterwards under musl.
# Copying the data out and back in through same-family images sidesteps that
# entirely, because every index is rebuilt in its final environment.
#
# Non-destructive by construction: the source volume is only ever read from, and
# the migrated data lands in a second volume. Roll back by pointing Compose at
# the original volume again.
#
# Only the four Spectrum KNX tables are carried across. The application rebuilds
# its own TimescaleDB state on startup — telegrams becomes a hypertable
# (migrate_data => TRUE) and the compression policy is re-applied — so
# TimescaleDB's own catalog does not need to be preserved and the extension
# versions need not match.

set -euo pipefail

TARGET_MAJOR="${TARGET_MAJOR:-18}"
SOURCE_VOLUME="${SOURCE_VOLUME:-}"
TARGET_VOLUME="${TARGET_VOLUME:-}"
DB_IMAGE_BASE="${DB_IMAGE_BASE:-timescale/timescaledb}"
TABLES=(string_lookup store_metadata telegrams last_ga_telegrams)

SRC_CTR="spectrumknx-migrate-src"
TGT_CTR="spectrumknx-migrate-tgt"
NETWORK="spectrumknx-migrate-net"

log()  { echo "[compose-migrate] $*"; }
fail() { echo "[compose-migrate] ERROR: $*" >&2; exit 1; }

cleanup() {
    docker rm -f "$SRC_CTR" "$TGT_CTR" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v docker >/dev/null || fail "docker is not on PATH."

# Read credentials from .env so they match the running stack. Parsed, not
# sourced: Compose does not shell-evaluate .env, and real files contain values
# with spaces that a "set -a; . ./.env" would try to execute.
env_value() {
    [ -f .env ] || return 0
    # Last assignment wins, as Compose does; strip one layer of quoting.
    sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1 \
        | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

POSTGRES_USER="${POSTGRES_USER:-$(env_value POSTGRES_USER)}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(env_value POSTGRES_PASSWORD)}"
POSTGRES_DB="${POSTGRES_DB:-$(env_value POSTGRES_DB)}"
POSTGRES_USER="${POSTGRES_USER:-knxuser}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-knxpassword}"
POSTGRES_DB="${POSTGRES_DB:-knx_analyzer}"

# ── Resolve the volumes ───────────────────────────────────────────────────────
if [ -z "$SOURCE_VOLUME" ]; then
    # Compose prefixes volume names with the project (directory) name.
    guess="$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]')_knx_db_data"
    if docker volume inspect "$guess" >/dev/null 2>&1; then
        SOURCE_VOLUME="$guess"
    else
        echo "Could not find the database volume automatically. Candidates:" >&2
        docker volume ls --format '  {{.Name}}' | grep -i knx >&2 || true
        fail "set SOURCE_VOLUME to the right one and re-run."
    fi
fi
docker volume inspect "$SOURCE_VOLUME" >/dev/null 2>&1 || fail "volume '$SOURCE_VOLUME' does not exist."
TARGET_VOLUME="${TARGET_VOLUME:-${SOURCE_VOLUME}_pg${TARGET_MAJOR}}"

log "Source volume: $SOURCE_VOLUME"
log "Target volume: $TARGET_VOLUME"

# ── Preflight ─────────────────────────────────────────────────────────────────
# PostgreSQL 18 changed the official images' layout: PGDATA moved from
# /var/lib/postgresql/data to /var/lib/postgresql/<major>/docker, with the volume
# mounted one level higher. A volume can therefore hold either shape, so probe
# both.
read_pg_version() {
    docker run --rm -v "$1:/pgdata:ro" alpine:3.22 sh -c '
        if [ -s /pgdata/PG_VERSION ]; then cat /pgdata/PG_VERSION; exit 0; fi
        for f in /pgdata/*/docker/PG_VERSION; do
            [ -s "$f" ] && { cat "$f"; exit 0; }
        done
        true
    ' 2>/dev/null | tr -d '[:space:]'
}

# Where the image for a given major expects its volume mounted.
volume_mount_for() {
    if [ "$1" -ge 18 ] 2>/dev/null; then
        echo "/var/lib/postgresql"
    else
        echo "/var/lib/postgresql/data"
    fi
}

SOURCE_MAJOR="$(read_pg_version "$SOURCE_VOLUME")"
[ -n "$SOURCE_MAJOR" ] || fail "'$SOURCE_VOLUME' holds no PostgreSQL cluster."
log "Source is PostgreSQL $SOURCE_MAJOR, target is PostgreSQL $TARGET_MAJOR"
[ "$SOURCE_MAJOR" != "$TARGET_MAJOR" ] || { log "Already on PostgreSQL $TARGET_MAJOR — nothing to do."; exit 0; }

if docker volume inspect "$TARGET_VOLUME" >/dev/null 2>&1; then
    existing="$(read_pg_version "$TARGET_VOLUME")"
    [ -z "$existing" ] || fail "'$TARGET_VOLUME' already holds a PostgreSQL $existing cluster. Remove it first (docker volume rm $TARGET_VOLUME) or set TARGET_VOLUME."
fi

# ── Start both clusters ───────────────────────────────────────────────────────
cleanup
docker network create "$NETWORK" >/dev/null

start_pg() {
    local name="$1" major="$2" volume="$3"
    docker run -d --name "$name" --network "$NETWORK" \
        -e POSTGRES_USER="$POSTGRES_USER" \
        -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
        -e POSTGRES_DB="$POSTGRES_DB" \
        -v "$volume:$(volume_mount_for "$major")" \
        "${DB_IMAGE_BASE}:latest-pg${major}" >/dev/null
    # Probe over TCP, not the socket. The official entrypoint runs a temporary
    # server with listen_addresses='' while initialising, then shuts it down and
    # starts the real one — a socket probe passes against that temporary server
    # and the next command hits "the database system is shutting down".
    local i
    for i in $(seq 1 90); do
        docker exec "$name" pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1 && return 0
        sleep 2
    done
    docker logs "$name" 2>&1 | tail -20 >&2
    fail "PostgreSQL $major ($name) did not become ready."
}

log "Starting the existing PostgreSQL $SOURCE_MAJOR cluster (read-only use)..."
start_pg "$SRC_CTR" "$SOURCE_MAJOR" "$SOURCE_VOLUME"

log "Initialising a fresh PostgreSQL $TARGET_MAJOR cluster..."
start_pg "$TGT_CTR" "$TARGET_MAJOR" "$TARGET_VOLUME"

psql_src() { docker exec -i "$SRC_CTR" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 "$@"; }
psql_tgt() { docker exec -i "$TGT_CTR" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 "$@"; }

# ── Which tables actually exist ───────────────────────────────────────────────
present=()
for t in "${TABLES[@]}"; do
    if [ "$(psql_src -Atc "SELECT to_regclass('public.$t') IS NOT NULL")" = "t" ]; then
        present+=("$t")
    fi
done
[ ${#present[@]} -gt 0 ] || fail "none of the Spectrum KNX tables were found in '$POSTGRES_DB'."
log "Tables to migrate: ${present[*]}"

declare -A before
for t in "${present[@]}"; do
    before[$t]="$(psql_src -Atc "SELECT count(*) FROM $t")"
    log "  $t: ${before[$t]} rows"
done

# ── Schema ────────────────────────────────────────────────────────────────────
# The hypertable's parent dumps as a plain CREATE TABLE with its indexes and no
# TimescaleDB triggers, which is exactly the shape the application expects to
# find and then convert on startup.
log "Copying the schema..."
dump_args=()
for t in "${present[@]}"; do dump_args+=(-t "$t"); done
docker exec "$SRC_CTR" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --schema-only --no-owner --no-privileges "${dump_args[@]}" \
    | psql_tgt -q

# ── Data ──────────────────────────────────────────────────────────────────────
# COPY (SELECT ...) reads straight through compressed chunks, so compression
# state on the source is irrelevant.
for t in "${present[@]}"; do
    log "Copying $t (${before[$t]} rows)..."
    docker exec "$SRC_CTR" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 \
        -c "COPY (SELECT * FROM $t) TO STDOUT" \
        | psql_tgt -q -c "COPY $t FROM STDIN"
done

# Sequences carry over their definition but not their position.
log "Advancing sequences..."
psql_tgt -q <<'SQL'
DO $$
DECLARE r record; maxid bigint;
BEGIN
    -- public only: the TimescaleDB extension owns sequences of its own in
    -- _timescaledb_catalog, which are none of our business.
    FOR r IN
        SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
        FROM pg_class s
        JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
        JOIN pg_class t ON t.oid = d.refobjid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
        WHERE s.relkind = 'S'
          AND s.relnamespace = 'public'::regnamespace
          AND t.relnamespace = 'public'::regnamespace
    LOOP
        EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM public.%I', r.col, r.tbl) INTO maxid;
        EXECUTE format('SELECT setval(%L, GREATEST(%s, 1))', 'public.' || r.seq, maxid);
    END LOOP;
END $$;
SQL

# ── Verify ────────────────────────────────────────────────────────────────────
log "Verifying..."
ok=true
for t in "${present[@]}"; do
    after="$(psql_tgt -Atc "SELECT count(*) FROM $t")"
    if [ "$after" != "${before[$t]}" ]; then
        echo "[compose-migrate] MISMATCH $t: ${before[$t]} -> $after" >&2
        ok=false
    else
        log "  $t: $after rows OK"
    fi
done
$ok || fail "row counts do not match. '$TARGET_VOLUME' is incomplete — delete it and retry. '$SOURCE_VOLUME' is untouched."

cat <<DONE

[compose-migrate] Migration complete.

  PostgreSQL $SOURCE_MAJOR  ->  PostgreSQL $TARGET_MAJOR
  data now in volume: $TARGET_VOLUME
  original volume:    $SOURCE_VOLUME  (untouched)

Now point Compose at the migrated volume. PostgreSQL $TARGET_MAJOR images place
their data in a subdirectory, so the mount path changes too — in
docker-compose.yml, for both the db and db-precheck services:

  db:
    volumes:
      - $TARGET_VOLUME:$(volume_mount_for "$TARGET_MAJOR")
  db-precheck:
    volumes:
      - $TARGET_VOLUME:/pgdata:ro

and in .env:

  DB_IMAGE=${DB_IMAGE_BASE}:latest-pg${TARGET_MAJOR}
  EXPECTED_PG_MAJOR=$TARGET_MAJOR

then start the stack:

  docker compose up -d

Spectrum KNX rebuilds the hypertable and compression policy on this first start,
so give it a moment before judging query speed.

To roll back, remove those lines from .env. Delete $SOURCE_VOLUME only once you
are satisfied everything works.
DONE
