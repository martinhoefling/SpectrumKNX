# Image carrying two PostgreSQL majors plus TimescaleDB, used to migrate a
# Spectrum KNX data directory in place (#432).
#
# The same package set the Home Assistant add-on uses for its transition
# release, so the migration is exercised here exactly as it runs there.
FROM debian:trixie-slim

ARG SOURCE_MAJORS="15"
ARG TARGET_MAJOR="18"
# Newest TimescaleDB that still supports PostgreSQL 15. The packages bundle
# every historical versioned .so (PG15: 2.11.0-2.28.3, PG18: 2.23.0-2.29.2), so
# this version is loadable by both majors — that overlap is what makes
# pg_upgrade possible across the TimescaleDB boundary.
ARG TS_VERSION_SOURCE="2.28.3~debian12-1518"
ARG TS_VERSION_TARGET="2.29.2~debian12-1804"

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg2 locales procps \
    && rm -rf /var/lib/apt/lists/*

# pg_upgrade compares locale settings; generate the common default so a cluster
# created with it can be migrated.
RUN sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen

RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] http://apt.postgresql.org/pub/repos/apt trixie-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list

# PackageCloud has no Debian trixie packages; bookworm is ABI-compatible.
RUN curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey \
      -o /usr/share/keyrings/timescaledb-archive-keyring.asc \
    && echo "deb [signed-by=/usr/share/keyrings/timescaledb-archive-keyring.asc] https://packagecloud.io/timescale/timescaledb/debian/ bookworm main" \
      > /etc/apt/sources.list.d/timescaledb.list

RUN apt-get update \
    && for m in $SOURCE_MAJORS; do \
         apt-get install -y --no-install-recommends \
           "postgresql-$m" "timescaledb-2-postgresql-$m=$TS_VERSION_SOURCE"; \
       done \
    && apt-get install -y --no-install-recommends \
         "postgresql-$TARGET_MAJOR" "postgresql-client-$TARGET_MAJOR" \
         "timescaledb-2-postgresql-$TARGET_MAJOR=$TS_VERSION_TARGET" \
    && rm -rf /var/lib/apt/lists/*

COPY packaging/pg-migrate/migrate.sh /usr/local/bin/pg-migrate
RUN chmod +x /usr/local/bin/pg-migrate

ENV DATADIR=/var/lib/postgresql/data
ENV TARGET_MAJOR=18
USER postgres
ENTRYPOINT ["/usr/local/bin/pg-migrate"]
