# Development Guide

This document provides instructions for setting up the development environment, understanding the technology stack, and deploying the application using Docker.

## Technology Stack

### Backend
- **Language:** Python 3.11+
- **Framework:** [FastAPI](https://fastapi.tiangolo.com/)
- **KNX Integration:** [xknx](https://xknx.io/) for bus communication and [xknxproject](https://github.com/XKNX/xknxproject) for ETS project parsing.
- **ORM:** [SQLAlchemy](https://www.sqlalchemy.org/) (Async)
- **Database Driver:** `asyncpg`

### Frontend
- **Framework:** [React](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Language:** TypeScript
- **State Management:** React Hooks
- **Data Table:** [TanStack Table v8](https://tanstack.com/table/v8)
- **Icons:** [Lucide React](https://lucide.dev/)
- **Styling:** Vanilla CSS (Modern CSS variables, Flexbox/Grid)

### Storage & Infrastructure
- **Database:** [PostgreSQL 15](https://www.postgresql.org/) with [TimescaleDB](https://www.timescale.com/) extension.
- **Containerization:** [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/).

---

## Getting Started

### 1. Prerequisites
- Docker and Docker Compose installed.
- Python 3.11 installed (for local backend development).
- Node.js installed (for local frontend development).

### 2. Environment Configuration
Copy the example environment file and adjust the values as needed:
```bash
cp .env_example .env
```
Key variables:
- `DATABASE_URL`: (Optional) Full connection string for the PostgreSQL database.
- `POSTGRES_USER/PASSWORD/DB`: Individual credentials used if `DATABASE_URL` is omitted.
- `KNX_PASSWORD`: Password for your ETS project export.
- `KNX_GATEWAY_IP`: IP of your KNX interface (or `AUTO`).
- `APP_IMAGE`: Docker image to use for production stacks.

### 3. Database Setup
The easiest way to run the database is via Docker Compose. This will automatically set up TimescaleDB and run the initialization scripts in `./db/init.sql`.

```bash
docker-compose up -d db
```

### 4. Running the Backend

#### Locally (Recommended for Development)
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```
The API will be available at `http://localhost:8000`.

#### Via Docker
```bash
docker-compose up backend
```

### 5. Running the Frontend
The frontend currently runs natively using the Vite development server.

```bash
cd frontend
npm install
npm run dev
```
The application will be available at `http://localhost:5173`.

---

## Docker Stacks

Spectrum KNX uses a multi-stack Docker approach to balance development productivity with production reliability.

### 1. Development Stack (Default)
Used for daily coding. Includes the Vite development server and auto-reloading backend.
```bash
docker-compose up -d
```
Docker automatically uses `docker-compose.override.yml` for this mode, which mounts your local source code for live-reloading.

### 2. Production Stack
Pulls the monolithic pre-built image from GHCR. Does not require local Node.js or high build times.
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```
This mode ignores local builds and mounts, using the official image instead.

---

## Project Structure

- `/backend`: FastAPI application, KNX daemon, and database models.
- `/frontend`: React application and UI components.
- `/db`: Database initialization scripts and hypertable configurations.
- `/project`: Directory for storing ETS `.knxproj` files for parsing.
- `docker-compose.yml`: Main orchestration file for services.
