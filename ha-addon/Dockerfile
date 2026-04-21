ARG BUILD_FROM="ghcr.io/hassio-addons/debian-base/amd64:7.3.3"

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
RUN echo "deb http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -

# Add TimescaleDB repository
RUN echo "deb https://packagecloud.io/timescale/timescaledb/debian/ bookworm main" > /etc/apt/sources.list.d/timescaledb.list \
    && wget --quiet -O - https://packagecloud.io/timescale/timescaledb/gpgkey | apt-key add -

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
