#!/usr/bin/env bash
# Build the migration image and run the migration test suite (#432).
#
# Both privilege modes are covered: unprivileged (how the standalone image runs)
# and root-dropping-to-postgres (how the Home Assistant add-on runs).
#
# Usage: packaging/pg-migrate/test/run-tests.sh   [from the repository root]

set -euo pipefail

IMAGE="${IMAGE:-spectrumknx-pg-migrate:test}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

echo "Building $IMAGE..."
docker build -q -f packaging/pg-migrate/Dockerfile -t "$IMAGE" . >/dev/null

run_case() {
    local name="$1" script="$2"; shift 2
    echo
    echo "########## $name ##########"
    docker run --rm "$@" --entrypoint bash \
        -v "$REPO_ROOT/packaging/pg-migrate/test/$script:/test.sh:ro" \
        "$IMAGE" -c 'chown -R postgres:postgres /var/lib/postgresql 2>/dev/null || true; exec /test.sh'
}

run_case "migration, unprivileged"          e2e.sh
run_case "migration, root -> postgres"      e2e.sh           --user root
run_case "failure paths, unprivileged"      failure-paths.sh
run_case "failure paths, root -> postgres"  failure-paths.sh --user root

echo
echo "All migration tests passed."
