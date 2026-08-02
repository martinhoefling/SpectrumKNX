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

# Install PostgreSQL 15 and TimescaleDB
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-15 \
    timescaledb-2-postgresql-15 \
    postgresql-client-15 \
    && rm -rf /var/lib/apt/lists/*

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
