#!/usr/bin/env bash
# The migration must fail safe: whenever it refuses or errors, the original data
# directory has to be left exactly as it was (#432).

set -euo pipefail

DATADIR="${DATADIR:-/var/lib/postgresql/data}"
SOURCE_MAJOR="${SOURCE_MAJOR:-15}"
OLD_BIN="/usr/lib/postgresql/$SOURCE_MAJOR/bin"
SOCK="/tmp/pgsock-fail"
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

say "Creating a small PostgreSQL $SOURCE_MAJOR cluster"
rm -rf "$DATADIR" "${DATADIR}.old-$SOURCE_MAJOR" "${DATADIR}.new-18"
mkdir -p "$DATADIR"
[ "$(id -u)" = "0" ] && chown postgres:postgres "$DATADIR"
run_pg "$OLD_BIN/initdb" -D "$DATADIR" --encoding=UTF8 --lc-collate="$TEST_LOCALE" --lc-ctype="$TEST_LOCALE" >/dev/null
echo "shared_preload_libraries = 'timescaledb'" >> "$DATADIR/postgresql.conf"
run_pg "$OLD_BIN/pg_ctl" -D "$DATADIR" -w -o "-c listen_addresses='' -c unix_socket_directories='$SOCK'" start >/dev/null
run_pg "$OLD_BIN/psql" -h "$SOCK" -U postgres -X -q -d postgres -c "CREATE DATABASE spectrum_knx"
run_pg "$OLD_BIN/psql" -h "$SOCK" -U postgres -X -q -d spectrum_knx -c "CREATE EXTENSION timescaledb"
run_pg "$OLD_BIN/psql" -h "$SOCK" -U postgres -X -q -d spectrum_knx -c "CREATE TABLE marker (id int); INSERT INTO marker VALUES (42)"
run_pg "$OLD_BIN/pg_ctl" -D "$DATADIR" -m fast -w stop >/dev/null

FINGERPRINT_BEFORE="$(cat "$DATADIR/PG_VERSION")-$(find "$DATADIR" -type f | wc -l)"

assert_intact() {
    local now
    now="$(cat "$DATADIR/PG_VERSION")-$(find "$DATADIR" -type f | wc -l)"
    [ "$now" = "$FINGERPRINT_BEFORE" ] || fail "$1: data directory was modified ($FINGERPRINT_BEFORE -> $now)"
    [ -e "${DATADIR}.old-${SOURCE_MAJOR}" ] && fail "$1: a backup directory was created despite failing"
    [ -e "${DATADIR}.new-18" ] && fail "$1: a partial new cluster was left behind"
    echo "  data directory intact"
}

say "Refuses when there is not enough free space"
if DATADIR="$DATADIR" TARGET_MAJOR=18 SPACE_MARGIN_PERCENT=100000000 /usr/local/bin/pg-migrate; then
    fail "migration succeeded despite the space check failing"
fi
assert_intact "space check"

say "Refuses to downgrade"
if DATADIR="$DATADIR" TARGET_MAJOR=13 /usr/local/bin/pg-migrate 2>/dev/null; then
    fail "migration accepted a downgrade"
fi
assert_intact "downgrade"

say "Refuses when the source major's binaries are absent"
# A cluster claiming a major this image cannot open.
echo "14" > "$DATADIR/PG_VERSION"
if DATADIR="$DATADIR" TARGET_MAJOR=18 /usr/local/bin/pg-migrate 2>/dev/null; then
    fail "migration proceeded without binaries for the source major"
fi
echo "$SOURCE_MAJOR" > "$DATADIR/PG_VERSION"
assert_intact "missing binaries"

say "Is a no-op when already on the target version"
DATADIR="$DATADIR" TARGET_MAJOR="$SOURCE_MAJOR" /usr/local/bin/pg-migrate | grep -q "nothing to do" \
    || fail "same-version run did not report a no-op"
assert_intact "no-op"

say "Refuses when a previous backup directory is in the way"
mkdir -p "${DATADIR}.old-${SOURCE_MAJOR}"
if DATADIR="$DATADIR" TARGET_MAJOR=18 /usr/local/bin/pg-migrate 2>/dev/null; then
    fail "migration overwrote an existing backup directory"
fi
rmdir "${DATADIR}.old-${SOURCE_MAJOR}"

say "PASS — every failure path left the original cluster untouched"
