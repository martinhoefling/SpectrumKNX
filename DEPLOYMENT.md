# Deployment Guide

Spectrum KNX is designed as a modular 12-factor application, making it agnostic to whether it is running in Docker, raw Linux, or orchestrated via Kubernetes.

## Prerequisites
No matter the deployment, you will need:
1. An ETS project file (`.knxproj`) parsed by the backend to translate KNX payloads.
2. A running PostgreSQL database with the **TimescaleDB** extension installed.

---

## 1. Docker (Recommended for Standalone Use)
The application provides a ready-to-use production stack that pulls the monolithic image from GHCR.

```bash
# Pull the latest image and start the stack
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## 2. Home Assistant Add-on

Spectrum KNX can be installed as a native **Home Assistant Add-on**. This is the easiest way to run it alongside an existing Home Assistant installation. The Add-on bundles everything (PostgreSQL + TimescaleDB + Backend + Frontend) into a single container managed by the HA Supervisor.

### 2.1 Installation

1. Open your Home Assistant instance.
2. Navigate to **Settings → Add-ons → Add-on Store**.
3. Click the **⋮** (three dots) menu in the top right corner and select **Repositories**.
4. Add the following repository URL:
   ```
   https://github.com/martinhoefling/SpectrumKNX
   ```
5. Click **Add**, then close the dialog.
6. The **Spectrum KNX** Add-on should now appear in the store. Click on it.
7. Click **Install** and wait for the image to download (this may take a few minutes on first install).

### 2.2 Configuration

After installation, go to the **Configuration** tab of the Add-on. The following options are available:

| Option | Description | Default |
|---|---|---|
| `KNX_GATEWAY_IP` | IP address of your KNX IP Gateway/Router. Use `AUTO` to scan the network automatically. | `AUTO` |
| `KNX_GATEWAY_PORT` | Port of your KNX IP Gateway. | `3671` |
| `LOG_LEVEL` | Logging verbosity (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`). | `INFO` |

Example configuration (YAML view):
```yaml
KNX_GATEWAY_IP: "192.168.1.100"
KNX_GATEWAY_PORT: 3671
LOG_LEVEL: "INFO"
```

### 2.3 Starting the Add-on

1. Go to the **Info** tab and click **Start**.
2. Enable **Show in sidebar** to access the UI directly from the Home Assistant navigation.
3. Optionally, enable **Start on boot** so the Add-on starts automatically after a reboot.

### 2.4 Uploading the ETS Project File

The Add-on uses the built-in **Project Upload Wizard** for ETS project configuration — no file paths or manual mounting required.

1. After starting the Add-on for the first time, open it from the sidebar (or click **Open Web UI**).
2. You will be greeted by the **Project Setup** screen.
3. Click **Choose File** and select your `.knxproj` file exported from ETS.
4. Enter the project password (if the project is password-protected, leave blank otherwise).
5. Click **Upload & Start**.
6. The backend will validate the password against the project file. If the password is incorrect, an error will be shown and you can retry.
7. Once validated, the backend will start decoding KNX bus traffic immediately.

> **Note:** The uploaded project file is persisted in the Add-on's `/data` volume and will survive Add-on restarts and updates. To replace it later, go to **Settings** within the Spectrum KNX UI.

### 2.5 KNX Secure Keys

If your KNX installation uses KNX IP Secure, you can upload a `.knxkeys` file via the web UI. See [Section 5: KNX Secure Keys](#5-knx-secure-keys) for details on the auto-detection, upload, and hot-reload behavior.

### 2.6 Data Persistence

All data is stored in the Add-on's persistent `/data` directory, which is managed by the Home Assistant Supervisor:

| Data | Location | Persisted? |
|---|---|---|
| PostgreSQL / TimescaleDB | `/data/postgres/` | ✅ Survives restarts & updates |
| Uploaded `.knxproj` file | `/data/project/` | ✅ Survives restarts & updates |
| Uploaded project password | `/data/project/` | ✅ Survives restarts & updates |
| Uploaded `.knxkeys` file | `/data/project/` | ✅ Survives restarts & updates |
| Uploaded keys password | `/data/project/` | ✅ Survives restarts & updates |

> **Important:** Uninstalling the Add-on will delete all data. If you want to keep your telegram history, export it before uninstalling.

### 2.7 Database Access
By default, the internal PostgreSQL database is restricted to `127.0.0.1` for security, as the Add-on runs on the host network. This ensures it is not exposed to your local network.

To connect external tools (e.g., Grafana) to the database, you must access it from the same host or use a SSH tunnel to port `5432`.

### 2.8 Supported Architectures

| Architecture | Supported |
|---|---|
| `amd64` (Intel/AMD) | ✅ |
| `aarch64` (Raspberry Pi 4/5, ARM64) | ✅ |

---

## 3. Kubernetes
Example manifests for deploying Spectrum KNX on Kubernetes can be found in the [kubernetes/](kubernetes/) directory.

These templates cover:
- StatefulSets for the Backend and TimescaleDB
- Persistent Volume Claims for data persistence
- Ingress configuration
- Secret management

See the [Kubernetes README](kubernetes/README.md) for specific deployment instructions.

---

## 4. Configuration Variables (Docker / Kubernetes)
You can configure the application via environment variables. These can be set in a `.env` file or directly in your environment.

### DB Connection
| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | (Optional) Full SQLAlchemy connection string (must use `postgresql+asyncpg://`) | N/A |
| `POSTGRES_USER` | Database username | `knxuser` |
| `POSTGRES_PASSWORD`| Database password | `knxpassword` |
| `POSTGRES_DB` | Database name | `knx_analyzer` |
| `POSTGRES_HOST` | Database host | `db` |
| `POSTGRES_PORT` | Database port | `5432` |

### KNX Settings
| Variable | Description | Default |
|---|---|---|
| `KNX_PASSWORD` | Password for the ETS project file | N/A |
| `KNX_PROJECT_PATH`| Path to the `.knxproj` file | `/project/knx_project.knxproj` |
| `KNX_CONNECTION_TYPE` | Type of connection (`AUTOMATIC`, `TUNNELING`, `TUNNELING_TCP`, `TUNNELING_TCP_SECURE`, `ROUTING`, `ROUTING_SECURE`) | `AUTOMATIC` |
| `KNX_GATEWAY_IP` | IP of the KNX IP Gateway (or `AUTO` for scan) | `AUTO` |
| `KNX_GATEWAY_PORT`| Port of the KNX IP Gateway | `3671` |
| `KNX_LOCAL_IP` | Local IP or interface name to bind to | N/A |
| `KNX_INDIVIDUAL_ADDRESS`| Individual address (e.g. `1.1.100`) | N/A |
| `KNX_ROUTE_BACK` | Enable route back for NAT/Docker bridge | `false` |
| `KNX_MULTICAST_GROUP`| Multicast group for routing | `224.0.23.12`|
| `KNX_MULTICAST_PORT` | Multicast port for routing | `3671` |
| `KNX_KNXKEYS_FILE` | Path to the `.knxkeys` file (auto-detected at `/project/knx_keys.knxkeys` if not set) | N/A |
| `KNX_KNXKEYS_PASSWORD`| Password for the `.knxkeys` file | N/A |
| `KNX_SECURE_USER_ID` | User ID for Secure Tunneling | N/A |
| `KNX_SECURE_USER_PASSWORD`| User Password for Secure Tunneling | N/A |
| `KNX_SECURE_DEVICE_PASSWORD`| Device Password for Secure Tunneling | N/A |
| `KNX_SECURE_BACKBONE_KEY`| Backbone Key (hex) for Secure Routing | N/A |
| `KNX_SECURE_LATENCY_MS`| Latency in ms for Secure Routing | N/A |

### Configuration Examples

#### NAT / Docker Bridge Mode
If your container is running in a bridge network and cannot receive responses from the gateway:
```env
KNX_ROUTE_BACK=true
```

#### KNX Multicast Routing
For installations with IP routers:
```env
KNX_CONNECTION_TYPE=ROUTING
```

#### KNX Secure Tunneling (using knxkeys)
```env
KNX_CONNECTION_TYPE=TUNNELING_TCP_SECURE
KNX_KNXKEYS_FILE=/project/house.knxkeys
KNX_KNXKEYS_PASSWORD=my_secure_password
```

### System Settings
| Variable | Description | Default |
|---|---|---|
| `LOG_LEVEL` | Logging verbosity (DEBUG, INFO, etc.) | `INFO` |
| `APP_IMAGE` | Docker image to pull (Prod Stack only) | `ghcr.io/martinhoefling/spectrum-knx:latest` |

---

## 5. KNX Secure Keys

Spectrum KNX supports **KNX IP Secure** (both Tunneling and Routing) via `.knxkeys` files exported from ETS.

### 5.1 Auto-Detection

When `KNX_KNXKEYS_FILE` is **not** set, the daemon automatically looks for a keyfile at the default path:

```
/project/knx_keys.knxkeys
```

The password is read from:

```
/project/knx_keys_password
```

This means you can simply place the files at those paths (or upload them via the UI) without any environment variable configuration.

### 5.2 Upload via Web UI

If the `KNX_KNXKEYS_FILE` environment variable is **not** set, the Spectrum KNX UI provides an upload wizard accessible from **Settings → KNX Security Keys**:

1. Open the Spectrum KNX web interface.
2. Navigate to **Settings** (via the dropdown menu).
3. Click **Upload / Replace KNX Keys File (.knxkeys)**.
4. Select the `.knxkeys` file exported from ETS and enter the password.
5. Click **Upload & Apply**.

The backend will immediately **reconnect** to the KNX bus using the new credentials. No restart is required.

### 5.3 Hot-Reload

The daemon watches the knxkeys file for changes every 60 seconds. If the file is replaced on disk (e.g., via a volume mount update or a new upload), the daemon will automatically:

1. Detect the file modification
2. Disconnect from the KNX bus
3. Rebuild the secure configuration
4. Reconnect with the new credentials

### 5.4 Secure Configuration Priority

If multiple security methods are configured simultaneously, the daemon uses the following priority:

1. **`.knxkeys` file** — highest priority. If a keyfile is present (via env var or auto-detected), all other manual secure variables are ignored.
2. **Backbone Key** (`KNX_SECURE_BACKBONE_KEY`) — used for Secure Routing if no keyfile is present.
3. **Manual Tunneling Credentials** (`KNX_SECURE_USER_ID` + `KNX_SECURE_USER_PASSWORD`) — lowest priority.

Conflicts are logged as warnings.
