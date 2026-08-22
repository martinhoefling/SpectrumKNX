ARG BUILD_FROM="ghcr.io/hassio-addons/debian-base/amd64:9.3.0"

# Stage 1: Build the React frontend
FROM node:24-slim AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Final Add-on Image
FROM $BUILD_FROM

# Install prerequisites
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg2 \
    lsb-release \
    curl \
    ca-certificates \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Add PostgreSQL repository
RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] http://apt.postgresql.org/pub/repos/apt trixie-pgdg main" > /etc/apt/sources.list.d/pgdg.list

# Add TimescaleDB repository
# PackageCloud does not yet have Debian trixie packages; use bookworm which is ABI-compatible.
RUN curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey \
      -o /usr/share/keyrings/timescaledb-archive-keyring.asc \
    && echo "deb [signed-by=/usr/share/keyrings/timescaledb-archive-keyring.asc] https://packagecloud.io/timescale/timescaledb/debian/ bookworm main" \
      > /etc/apt/sources.list.d/timescaledb.list

# PostgreSQL: the runtime major, plus the previous one so an existing data
# directory can be migrated in place on first start (#432).
#
# The pinned TimescaleDB versions are deliberate. pg_upgrade carries the
# pg_extension catalog across, so the new major must be able to load the
# extension at the version the old cluster recorded. 2.28.3 is the newest that
# still supports PG15, and the PG18 package bundles every historical versioned
# .so (2.23.0-2.29.2) — that overlap is what makes the upgrade possible.
ARG PG_MAJOR=18
ARG PG_MIGRATE_FROM_MAJOR=15
ARG TS_VERSION_NEW="2.29.2~debian12-1804"
ARG TS_VERSION_OLD="2.28.3~debian12-1518"
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-${PG_MAJOR} \
    postgresql-client-${PG_MAJOR} \
    timescaledb-2-postgresql-${PG_MAJOR}=${TS_VERSION_NEW} \
    postgresql-${PG_MIGRATE_FROM_MAJOR} \
    timescaledb-2-postgresql-${PG_MIGRATE_FROM_MAJOR}=${TS_VERSION_OLD} \
    && rm -rf /var/lib/apt/lists/*

# In-place major-version migration, shared with the standalone image.
COPY packaging/pg-migrate/migrate.sh /usr/local/bin/pg-migrate
RUN chmod +x /usr/local/bin/pg-migrate

# Configure PostgreSQL for TimescaleDB
RUN timescaledb-tune --quiet --yes || true

# Setup PostgreSQL directories
RUN mkdir -p /var/run/postgresql && chown -R postgres:postgres /var/run/postgresql && chmod 2775 /var/run/postgresql
RUN mkdir -p /var/lib/postgresql/data && chown -R postgres:postgres /var/lib/postgresql

# Create virtual environment for Python
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install backend dependencies
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./

# Copy built frontend
COPY --from=frontend-builder /app/dist /app/backend/static

# Copy s6-overlay service definitions
COPY ha-addon/rootfs /
RUN chmod +x /etc/services.d/*/run

# Set the environment variable for Postgres connection
ENV DATABASE_URL="postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/spectrum_knx"

# The base image handles the s6-overlay entrypoint
