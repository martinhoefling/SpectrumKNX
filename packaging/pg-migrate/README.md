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

Run the migration against the existing volume before changing the `db` image
tag:

```bash
docker compose down
docker compose -f docker-compose.yml -f docker-compose.migrate.yml run --rm pg-migrate
# then update the db image tag in docker-compose.yml and:
docker compose up -d
```

> **Only for Debian-based PostgreSQL images.** The stock
> `timescale/timescaledb` images are Alpine/musl, and a cluster created there
> must not be opened with the Debian/glibc binaries this image carries —
> collation differs, which silently corrupts text index ordering. For those,
> use the logical route below instead.

### Logical alternative (any image, any version)

Spectrum KNX rebuilds its own TimescaleDB state on startup: `telegrams` is
re-created as a hypertable (`migrate_data => TRUE`) and the compression policy
re-applied every time the application initialises. So a plain dump/restore of
the four tables into a fresh cluster is sufficient — TimescaleDB's own catalog
does not need to be preserved and the extension versions need not match.

```bash
# from the old container
pg_dump -U knxuser -d knx_analyzer --data-only \
    -t telegrams -t last_ga_telegrams -t string_lookup -t store_metadata \
    > spectrum-knx-data.sql
# into a fresh cluster on the new major, after Spectrum KNX has created the schema
psql -U knxuser -d knx_analyzer < spectrum-knx-data.sql
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
