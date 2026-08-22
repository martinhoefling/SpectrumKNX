#!/usr/bin/env bash
# PostgreSQL major-version migration for a Spectrum KNX data directory (#432).
#
# Runs pg_upgrade in copy mode: the original data directory is never modified,
# so a failure at any point leaves the installation exactly as it was. On
# success the old directory is kept as "<datadir>.old-<major>" for the user to
# delete once satisfied — we never remove it automatically.
#
# TimescaleDB makes this more involved than a stock upgrade. pg_upgrade carries
# the pg_extension catalog across, so the new cluster must be able to load the
# extension at *exactly* the version recorded in the old one. The Debian
# packages bundle every historical versioned .so (the PG15 package spans
# 2.11.0-2.28.3, the PG18 package 2.23.0-2.29.2), which gives an overlap: bring
# the old cluster up to the newest version it supports first, and the new
# cluster can then load it. Afterwards the extension is updated again to the
# newest version the target major supports.
#
# pg_upgrade refuses to run as root, but renaming directories in the add-on's
# /data needs root. So the script may run as either: as root it drops to the
# postgres user for every PostgreSQL command (PG_RUNAS_CMD), and as an
# unprivileged user it runs them directly.

set -euo pipefail

DATADIR="${DATADIR:-/var/lib/postgresql/data}"
TARGET_MAJOR="${TARGET_MAJOR:-}"
PG_LIB_ROOT="${PG_LIB_ROOT:-/usr/lib/postgresql}"
# Free space required beyond the current size, as a percentage. pg_upgrade in
# copy mode writes a full second copy before the old one can be released.
SPACE_MARGIN_PERCENT="${SPACE_MARGIN_PERCENT:-15}"

PG_USER="${PG_USER:-postgres}"

log()  { echo "[pg-migrate] $*"; }
fail() { echo "[pg-migrate] ERROR: $*" >&2; exit 1; }

# How to run a PostgreSQL binary. Unset when we are already unprivileged.
PG_RUNAS_CMD="${PG_RUNAS_CMD:-}"
if [ "$(id -u)" = "0" ] && [ -z "$PG_RUNAS_CMD" ]; then
    if command -v s6-setuidgid >/dev/null 2>&1; then
        PG_RUNAS_CMD="s6-setuidgid $PG_USER"
    elif command -v setpriv >/dev/null 2>&1; then
        PG_RUNAS_CMD="setpriv --reuid=$PG_USER --regid=$PG_USER --init-groups --"
    else
        fail "running as root but no way to drop privileges to '$PG_USER' (need s6-setuidgid or setpriv)."
    fi
fi

# shellcheck disable=SC2086 # PG_RUNAS_CMD is a command prefix and must word-split
as_pg() { if [ -n "$PG_RUNAS_CMD" ]; then $PG_RUNAS_CMD "$@"; else "$@"; fi; }

# Make a path owned by the postgres user when we are root.
own_by_pg() { [ "$(id -u)" = "0" ] && chown -R "$PG_USER:$PG_USER" "$1" || true; }

usage() {
    cat >&2 <<USAGE
Usage: DATADIR=<dir> TARGET_MAJOR=<n> $0

Environment:
  DATADIR               PostgreSQL data directory (default /var/lib/postgresql/data)
  TARGET_MAJOR          Target major version (default: newest installed)
  SPACE_MARGIN_PERCENT  Extra free space required, percent (default 15)
USAGE
    exit 64
}

[ -d "$DATADIR" ] || fail "data directory does not exist: $DATADIR"

if [ -z "$TARGET_MAJOR" ]; then
    TARGET_MAJOR="$(ls -1 "$PG_LIB_ROOT" 2>/dev/null | sort -V | tail -n 1)"
fi
[ -n "$TARGET_MAJOR" ] || usage

if [ ! -s "$DATADIR/PG_VERSION" ]; then
    log "No existing cluster in $DATADIR — nothing to migrate."
    exit 0
fi

OLD_MAJOR="$(cat "$DATADIR/PG_VERSION")"
if [ "$OLD_MAJOR" = "$TARGET_MAJOR" ]; then
    log "Already on PostgreSQL $TARGET_MAJOR — nothing to do."
    exit 0
fi

# A downgrade is not something pg_upgrade can do; refuse rather than damage.
if [ "$(printf '%s\n%s\n' "$OLD_MAJOR" "$TARGET_MAJOR" | sort -V | head -n 1)" != "$OLD_MAJOR" ]; then
    fail "data directory is PostgreSQL $OLD_MAJOR but the target is older ($TARGET_MAJOR); refusing to downgrade."
fi

OLD_BIN="$PG_LIB_ROOT/$OLD_MAJOR/bin"
NEW_BIN="$PG_LIB_ROOT/$TARGET_MAJOR/bin"
[ -x "$OLD_BIN/pg_ctl" ]     || fail "no PostgreSQL $OLD_MAJOR binaries at $OLD_BIN (this image cannot migrate from $OLD_MAJOR)."
[ -x "$NEW_BIN/pg_upgrade" ] || fail "no PostgreSQL $TARGET_MAJOR binaries at $NEW_BIN."

NEW_DATADIR="${DATADIR}.new-${TARGET_MAJOR}"
BACKUP_DATADIR="${DATADIR}.old-${OLD_MAJOR}"

[ -e "$BACKUP_DATADIR" ] && fail "$BACKUP_DATADIR already exists — a previous migration left it behind. Move or delete it first."

# ── Preflight: disk space ─────────────────────────────────────────────────────
# Copy mode needs room for a second full copy. Refuse up front rather than fill
# the disk and fail halfway.
DATA_KB="$(du -sk "$DATADIR" | cut -f1)"
AVAIL_KB="$(df -Pk "$(dirname "$DATADIR")" | awk 'NR==2 {print $4}')"
REQUIRED_KB=$(( DATA_KB + DATA_KB * SPACE_MARGIN_PERCENT / 100 ))
log "Data directory: $(( DATA_KB / 1024 )) MiB; free: $(( AVAIL_KB / 1024 )) MiB; required: $(( REQUIRED_KB / 1024 )) MiB"
if [ "$AVAIL_KB" -lt "$REQUIRED_KB" ]; then
    fail "not enough free space to migrate safely: need $(( REQUIRED_KB / 1024 )) MiB, have $(( AVAIL_KB / 1024 )) MiB.
Free up space and restart. Nothing has been changed."
fi

WORKDIR="$(mktemp -d)"
SOCKETDIR="$WORKDIR/sockets"
mkdir -p "$SOCKETDIR"
# pg_upgrade writes its logs into the working directory and both servers need
# the socket directory, so postgres must own them.
own_by_pg "$WORKDIR"

cleanup_failed() {
    # Never touch $DATADIR on failure — it is still the live, working cluster.
    as_pg "$OLD_BIN/pg_ctl" -D "$DATADIR" -m immediate -w stop >/dev/null 2>&1 || true
    rm -rf "$NEW_DATADIR"
}

# ── 1. Bring the old cluster's extension up to the newest version it supports ─
# pg_upgrade needs the new cluster to load the extension at the recorded
# version. Starting the cluster here also guarantees the clean shutdown
# pg_upgrade insists on.
log "Starting PostgreSQL $OLD_MAJOR to prepare the upgrade..."
trap 'cleanup_failed' ERR
as_pg "$OLD_BIN/pg_ctl" -D "$DATADIR" -w -o "-c listen_addresses='' -c unix_socket_directories='$SOCKETDIR'" start >/dev/null

psql_old() { as_pg "$OLD_BIN/psql" -h "$SOCKETDIR" -U postgres -X -A -t "$@"; }

# Capture the locale/encoding so the new cluster is initialised to match —
# pg_upgrade rejects a mismatch.
ENCODING="$(psql_old -d postgres -c "SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname='template0'")"
LC_COLLATE_OLD="$(psql_old -d postgres -c "SELECT datcollate FROM pg_database WHERE datname='template0'")"
LC_CTYPE_OLD="$(psql_old -d postgres -c "SELECT datctype FROM pg_database WHERE datname='template0'")"
# PostgreSQL 18 turned data checksums on by default; earlier majors default to
# off. pg_upgrade refuses when the two clusters disagree, so the new cluster has
# to be initialised to match whatever the old one actually uses.
CHECKSUMS_OLD="$(psql_old -d postgres -c "SHOW data_checksums")"
log "Old cluster: encoding=$ENCODING collate=$LC_COLLATE_OLD ctype=$LC_CTYPE_OLD checksums=$CHECKSUMS_OLD"

for db in $(psql_old -d postgres -c "SELECT datname FROM pg_database WHERE datallowconn AND datname <> 'template0'"); do
    has_ts="$(psql_old -d "$db" -c "SELECT 1 FROM pg_extension WHERE extname='timescaledb'")"
    [ "$has_ts" = "1" ] || continue
    before="$(psql_old -d "$db" -c "SELECT extversion FROM pg_extension WHERE extname='timescaledb'")"
    # TimescaleDB requires this to be the first statement on a fresh connection.
    as_pg "$OLD_BIN/psql" -h "$SOCKETDIR" -U postgres -X -q -d "$db" -c "ALTER EXTENSION timescaledb UPDATE" >/dev/null
    after="$(psql_old -d "$db" -c "SELECT extversion FROM pg_extension WHERE extname='timescaledb'")"
    log "Database '$db': TimescaleDB $before -> $after"
done

log "Stopping PostgreSQL $OLD_MAJOR..."
as_pg "$OLD_BIN/pg_ctl" -D "$DATADIR" -m fast -w stop >/dev/null

# ── 2. Initialise the target cluster ──────────────────────────────────────────
log "Initialising a PostgreSQL $TARGET_MAJOR cluster..."
rm -rf "$NEW_DATADIR"
mkdir -p "$NEW_DATADIR"
own_by_pg "$NEW_DATADIR"
CHECKSUM_FLAG="--data-checksums"
if [ "$CHECKSUMS_OLD" != "on" ]; then
    # Only PostgreSQL 18+ knows --no-data-checksums; older majors default to off
    # anyway, so passing nothing is equivalent there.
    if as_pg "$NEW_BIN/initdb" --help 2>/dev/null | grep -q -- "--no-data-checksums"; then
        CHECKSUM_FLAG="--no-data-checksums"
    else
        CHECKSUM_FLAG=""
    fi
fi
# shellcheck disable=SC2086 # CHECKSUM_FLAG is deliberately unquoted: it may be empty
as_pg "$NEW_BIN/initdb" -D "$NEW_DATADIR" \
    --encoding="$ENCODING" --lc-collate="$LC_COLLATE_OLD" --lc-ctype="$LC_CTYPE_OLD" \
    $CHECKSUM_FLAG >/dev/null

# The extension must be preloadable before pg_upgrade restores the catalog.
{
    echo "shared_preload_libraries = 'timescaledb'"
    echo "listen_addresses = '127.0.0.1'"
} >> "$NEW_DATADIR/postgresql.conf"
grep -q "127.0.0.1/32" "$DATADIR/pg_hba.conf" 2>/dev/null \
    && echo "host all all 127.0.0.1/32 trust" >> "$NEW_DATADIR/pg_hba.conf"

# ── 3. pg_upgrade, copy mode ──────────────────────────────────────────────────
log "Running pg_upgrade ($OLD_MAJOR -> $TARGET_MAJOR), copy mode. This can take a while."
cd "$WORKDIR"
if ! as_pg "$NEW_BIN/pg_upgrade" \
        -b "$OLD_BIN" -B "$NEW_BIN" \
        -d "$DATADIR" -D "$NEW_DATADIR" \
        -s "$SOCKETDIR" >"$WORKDIR/pg_upgrade.log" 2>&1; then
    log "pg_upgrade failed; last 40 lines:"
    tail -n 40 "$WORKDIR/pg_upgrade.log" >&2 || true
    for f in "$WORKDIR"/pg_upgrade_*.log "$WORKDIR"/*/pg_upgrade_*.log; do
        [ -f "$f" ] && { log "--- $f ---"; tail -n 20 "$f" >&2; }
    done
    fail "pg_upgrade failed. Your original data directory is untouched and still usable."
fi
trap - ERR
log "pg_upgrade completed."

# ── 4. Swap directories ───────────────────────────────────────────────────────
# Two renames on the same filesystem; the window where neither is in place is
# as small as it can be made.
log "Swapping in the migrated cluster..."
mv "$DATADIR" "$BACKUP_DATADIR"
mv "$NEW_DATADIR" "$DATADIR"

# ── 5. Post-upgrade: newest extension version + statistics ────────────────────
log "Starting PostgreSQL $TARGET_MAJOR for post-upgrade steps..."
as_pg "$NEW_BIN/pg_ctl" -D "$DATADIR" -w -o "-c listen_addresses='' -c unix_socket_directories='$SOCKETDIR'" start >/dev/null

for db in $(as_pg "$NEW_BIN/psql" -h "$SOCKETDIR" -U postgres -X -A -t -d postgres \
        -c "SELECT datname FROM pg_database WHERE datallowconn AND datname <> 'template0'"); do
    has_ts="$(as_pg "$NEW_BIN/psql" -h "$SOCKETDIR" -U postgres -X -A -t -d "$db" -c "SELECT 1 FROM pg_extension WHERE extname='timescaledb'")"
    [ "$has_ts" = "1" ] || continue
    as_pg "$NEW_BIN/psql" -h "$SOCKETDIR" -U postgres -X -q -d "$db" -c "ALTER EXTENSION timescaledb UPDATE" >/dev/null || \
        log "WARNING: could not update the TimescaleDB extension in '$db'; it stays at the migrated version."
    now="$(as_pg "$NEW_BIN/psql" -h "$SOCKETDIR" -U postgres -X -A -t -d "$db" -c "SELECT extversion FROM pg_extension WHERE extname='timescaledb'")"
    log "Database '$db': TimescaleDB now $now"
done

# pg_upgrade does not carry planner statistics across.
log "Rebuilding planner statistics..."
as_pg "$NEW_BIN/vacuumdb" -h "$SOCKETDIR" -U postgres --all --analyze-in-stages >/dev/null 2>&1 || \
    log "WARNING: vacuumdb did not complete; the first queries may be slow until autovacuum catches up."

as_pg "$NEW_BIN/pg_ctl" -D "$DATADIR" -m fast -w stop >/dev/null
rm -rf "$WORKDIR"

RECLAIM_MB=$(( DATA_KB / 1024 ))
log "Migration complete: PostgreSQL $OLD_MAJOR -> $TARGET_MAJOR."
log "The previous cluster is kept at $BACKUP_DATADIR (~${RECLAIM_MB} MiB)."
log "Delete it once you are satisfied everything works; it is not removed automatically."
