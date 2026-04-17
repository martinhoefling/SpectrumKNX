# Deployment Guide

Spectrum KNX is designed as a modular 12-factor application, making it agnostic to whether it is running in Docker, raw Linux, or orchestrated via Kubernetes.

## Prerequisites
No matter the deployment, you will need:
1. An ETS project file (`.knxproj`) parsed by the backend to translate KNX payloads.
2. A running PostgreSQL database with the **TimescaleDB** extension installed.

---

## 1. Docker (Recommended)
The application provides a ready-to-use production stack that pulls the monolithic image from GHCR.

```bash
# Pull the latest image and start the stack
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## 2. Kubernetes (Helm / Manifests)
*(Coming Soon)*
> [!NOTE]
> Helm charts and standard K8s Deployment manifests will be updated here. The application respects standard environment variables for configuration.

---

## 3. Configuration Variables
You can configure the application via environment variables. These can be set in a `.env` file or directly in your environment.

### DB Connection
| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | (Optional) Full SQLAlchemy connection string | N/A |
| `POSTGRES_USER` | Database username | `knxuser` |
| `POSTGRES_PASSWORD`| Database password | `knxpassword` |
| `POSTGRES_DB` | Database name | `knx_analyzer` |
| `POSTGRES_HOST` | Database host | `db` |
| `POSTGRES_PORT` | Database port | `5432` |

### KNX Settings
| Variable | Description | Default |
|---|---|---|
| `KNX_PASSWORD` | Password for the ETS project file | N/A |
| `KNX_GATEWAY_IP` | IP of the KNX IP Gateway | `AUTO` |
| `KNX_GATEWAY_PORT`| Port of the KNX IP Gateway | `3671` |
| `KNX_PROJECT_PATH`| Path to the `.knxproj` file | `/project/knx_project.knxproj` |

### System Settings
| Variable | Description | Default |
|---|---|---|
| `LOG_LEVEL` | Logging verbosity (DEBUG, INFO, etc.) | `INFO` |
| `APP_IMAGE` | Docker image to pull (Prod Stack only) | `ghcr.io/martinhoefling/spectrum-knx:latest` |
