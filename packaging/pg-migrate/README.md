# PostgreSQL major-version migration

Tooling for moving a Spectrum KNX PostgreSQL data directory to a newer major
version (#432). A data directory can only be opened by the major that created
it, so the data must be migrated — pointing a newer server at it does not work.

## What `migrate.sh` does

`pg_upgrade` in **copy mode**, wrapped in the steps TimescaleDB requires:

1. Preflight — refuses unless there is room for a full second copy.
2. Starts the old cluster and updates the TimescaleDB extension to the newest
   version that major supports. This also guarantees the clean shutdown
   `pg_upgrade` insists on.
3. Initialises the target cluster matching the old one's encoding, collation and
   **data-checksum setting** (PostgreSQL 18 turned checksums on by default;
   `pg_upgrade` refuses when the two clusters disagree).
4. Runs `pg_upgrade`, then swaps the directories.
5. Updates the extension again to the newest the target major supports, and
   rebuilds planner statistics (`pg_upgrade` does not carry them across).

The original cluster is never modified. On success it is kept as
`<datadir>.old-<major>`; **it is never deleted automatically**. On any failure
nothing is swapped and the installation is left exactly as it was.

### Why the TimescaleDB versions are pinned

`pg_upgrade` carries the `pg_extension` catalog across, so the new cluster must
load the extension at *exactly* the version the old one recorded. TimescaleDB
dropped PostgreSQL 15 after 2.28.3, but its Debian packages bundle every
historical versioned `.so` — the PG15 package spans 2.11.0-2.28.3 and the PG18
package 2.23.0-2.29.2. That overlap is what makes the hop possible: bring the
old cluster up to 2.28.3, upgrade, then move to 2.29.2 on the far side.

## Home Assistant add-on

Nothing to do — the add-on carries this script and runs it automatically on the
first start after the bundled major changes. Take a Home Assistant backup first.

## Docker Compose

Use **`compose-migrate.sh`**, not the `pg_upgrade` image above:

```bash
docker compose down
SOURCE_VOLUME=<project>_knx_db_data packaging/pg-migrate/compose-migrate.sh
```

It starts your existing cluster and a fresh target cluster side by side, copies the
schema and the four Spectrum KNX tables across, verifies the row counts, and prints
the `docker-compose.yml` / `.env` edits to apply. The source volume is only ever
read from, so rollback is an edit rather than a restore.

### Why not `pg_upgrade` here

The stock `timescale/timescaledb` images are Alpine/musl, and a cluster created by
them reports `lc_collate=en_US.utf8` — which musl treats as byte ordering and glibc
as linguistic ordering. Running the Debian-based image above against such a cluster
would rebuild system catalog indexes under glibc collation, to then be served under
musl. `pg_upgrade` also cannot bridge the PostgreSQL 18 layout change on its own
(see below).

Copying the data out and back in through same-family images avoids both problems,
because every index is rebuilt in its final environment. It is slower than
`pg_upgrade`, which is the price of not having to reason about collation at all.

The `pg_upgrade` path remains the right one for the Home Assistant add-on, which is
Debian end to end and therefore has no such mismatch.

### The PostgreSQL 18 layout change

PostgreSQL 18 images keep their data in `/var/lib/postgresql/<major>/docker` and
expect the volume mounted one level up; 17 and older use `/var/lib/postgresql/data`.
A pg18 image pointed at an old-layout volume does not fail — it initialises an empty
cluster next to the untouched data. `compose-migrate.sh` and the `db-precheck`
service in `docker-compose.yml` both understand either shape; `DB_DATA_MOUNT`
selects the mount path.

### Checking without migrating

The `pg_upgrade` image can report a mismatch without touching anything:

```bash
docker run --rm -v <volume>:/var/lib/postgresql/data \
    -e CHECK_ONLY=true -e TARGET_MAJOR=18 <image>
```

## Kubernetes

Not covered — see `DEPLOYMENT.md` §10.3.

## Tests

```bash
packaging/pg-migrate/test/run-tests.sh
```

Builds the image and runs the suite in both privilege modes (unprivileged, and
root dropping to postgres as the add-on does). Covers a real hypertable with
compressed and uncompressed chunks, a collation-sensitive text index, an
extension deliberately created at an older version, and the failure paths —
each of which must leave the original directory untouched.
