# Deployment Guide

Spectrum KNX is designed as a modular 12-factor application, making it agnostic to whether it is running in Docker, raw Linux, or orchestrated via Kubernetes.

## Prerequisites
No matter the deployment, you will need:
1. An ETS project file (`.knxproj`) parsed by the backend to translate KNX payloads.
2. A database backend — either PostgreSQL (default), or SQLite (no external database required). The **TimescaleDB** extension is optional: when it is available on the PostgreSQL server it is used automatically (hypertable partitioning + native compression); without it, Spectrum KNX runs on plain PostgreSQL with identical functionality.

---

## 1. Docker (Recommended for Standalone Use)
The application provides a ready-to-use production stack that pulls the monolithic image from GHCR.

```bash
# Pull the latest image and start the stack
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## 2. Home Assistant Add-on

Spectrum KNX can be installed as a native **Home Assistant Add-on**. This is the easiest way to run it alongside an existing Home Assistant installation. The Add-on bundles everything (Backend + Frontend, plus PostgreSQL + TimescaleDB when needed) into a single container managed by the HA Supervisor.

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
| `DB_BACKEND` | Storage backend: `POSTGRES` (PostgreSQL; TimescaleDB is used automatically when available) or `SQLITE` (local file, no external database needed). | `POSTGRES` |

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

If your KNX installation uses KNX IP Secure, you can upload a `.knxkeys` file via the web UI. See [Section 6: KNX Secure Keys](#6-knx-secure-keys) for details on the auto-detection, upload, and hot-reload behavior.

### 2.6 Data Persistence

All data is stored in the Add-on's persistent `/data` directory, which is managed by the Home Assistant Supervisor:

| Data | Location | Persisted? |
|---|---|---|
| PostgreSQL / TimescaleDB (when `DB_BACKEND=POSTGRES`) | `/data/postgres/` | ✅ Survives restarts & updates |
| SQLite database (when `DB_BACKEND=SQLITE`) | `/data/spectrum_knx.db` | ✅ Survives restarts & updates |
| Uploaded `.knxproj` file | `/data/project/` | ✅ Survives restarts & updates |
| Uploaded project password | `/data/project/` | ✅ Survives restarts & updates |
| Uploaded `.knxkeys` file | `/data/project/` | ✅ Survives restarts & updates |
| Uploaded keys password | `/data/project/` | ✅ Survives restarts & updates |

> **Important:** Uninstalling the Add-on will delete all data. If you want to keep your telegram history, export it before uninstalling.

### 2.7 Database Access
This section applies only when `DB_BACKEND=POSTGRES`.

By default, the internal PostgreSQL database is restricted to `127.0.0.1` for security, as the Add-on runs on the host network. This ensures it is not exposed to your local network.

To connect external tools (e.g., Grafana) to the database, you must access it from the same host or use a SSH tunnel to port `5432`.

### 2.8 Supported Architectures

| Architecture | Supported |
|---|---|
| `amd64` (Intel/AMD) | ✅ |
| `aarch64` (Raspberry Pi 4/5, ARM64) | ✅ |

### 2.9 Companion Add-on (reads Home Assistant's KNX database)

The **Spectrum KNX (HA Companion)** add-on (same repository, separate add-on in the
store) runs the analyzer UI directly on the telegram history that Home Assistant's
own KNX integration records — instead of connecting to the bus and recording a
second copy:

- **No bus connection**: it needs no gateway, tunnel or KNX Secure configuration.
  Live telegrams are streamed from Home Assistant's websocket API
  (`knx/subscribe_telegrams`); after a reconnect, missed telegrams are replayed
  from the database so nothing is lost.
- **No database of its own**: it opens Home Assistant's telegram store
  (`.storage/knx/telegrams.db`) strictly read-only. The Database Maintenance
  screen becomes an info screen — retention and cleanup stay in Home Assistant.
- **Prerequisite**: the KNX integration must be set up in Home Assistant (it
  creates and writes the telegram database).

Options:

| Option | Description | Default |
|---|---|---|
| `LIVE_SOURCE` | `ha_websocket` (push, sub-second), `poll` (interval-poll the database) or `none`. | `ha_websocket` |
| `TELEGRAM_DB_PATH` | Override the telegram database path if auto-detection fails. | auto |
| `LOG_LEVEL` | Backend log level. | `INFO` |
| `COMPANION_MODE` | Marks this install as the companion variant — do not change. | `true` |

An ETS project upload is optional here: live telegram names come resolved from
Home Assistant, and uploading a project additionally enables the building view.

Both add-ons can run side by side (e.g. the standalone one on a dedicated tunnel
for long-term recording, the companion for HA's own history).

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

## 4. Debian Package & Windows (SQLite, no Docker)

Both packages run the analyzer as a single process with a local SQLite
database — no PostgreSQL/TimescaleDB, no container runtime. They are built for
every release and attached to the [GitHub release](https://github.com/martinhoefling/SpectrumKNX/releases);
see [PACKAGING.md](PACKAGING.md) for how they are built.

### 4.1 Debian / Ubuntu (amd64, arm64)

Requires Python ≥ 3.13 from the distribution (Debian 13 "trixie" or newer).

```bash
sudo apt install ./spectrum-knx_<version>_<arch>.deb
```

The package installs a systemd service (`spectrum-knx`, enabled and started
automatically) running as its own system user. Locations:

| Path | Purpose |
|---|---|
| `/etc/spectrum-knx/spectrum-knx.env` | configuration (env file, preserved on upgrades) |
| `/var/lib/spectrum-knx/` | SQLite database and uploaded `.knxproj` |
| `/opt/spectrum-knx/` | application + bundled Python venv |

Edit the env file (KNX connection, bind address/port — all variables from
[Section 5](#5-configuration-variables-docker--kubernetes) apply), then
`sudo systemctl restart spectrum-knx`. The web UI listens on port 8765 by
default. Logs: `journalctl -u spectrum-knx`. `apt purge` removes the database
and the service user; `apt remove` keeps them.

### 4.2 Windows (x64)

Unzip `spectrum-knx-<version>-windows-x64.zip` anywhere and run
`spectrum-knx.exe`: a console window shows the logs and the browser opens the
UI (default `http://localhost:8765`). A `README.txt` with the full setup
guide is included in the zip.

- Configuration lives in the `.env` file created next to the exe on first run
  (same variables as [Section 5](#5-configuration-variables-docker--kubernetes)).
- Data (SQLite database, uploaded `.knxproj`) is stored in
  `%LOCALAPPDATA%\SpectrumKNX\`.
- Windows Firewall asks for network permission on first start — required for
  gateway discovery and KNX routing (multicast).
- To upgrade, unzip the new version and copy your `.env` next to the new exe;
  the data directory in `%LOCALAPPDATA%` is untouched by upgrades.

---

## 5. Configuration Variables (Docker / Kubernetes)
You can configure the application via environment variables. These can be set in a `.env` file or directly in your environment.

### DB Connection
| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Full SQLAlchemy connection string. Use `postgresql+asyncpg://...` for PostgreSQL or `sqlite+aiosqlite:////path/to/file.db` for SQLite. When set, `POSTGRES_*` variables are ignored. | N/A |
| `POSTGRES_USER` | PostgreSQL username (used when `DATABASE_URL` is not set) | `knxuser` |
| `POSTGRES_PASSWORD`| PostgreSQL password | `knxpassword` |
| `POSTGRES_DB` | PostgreSQL database name | `knx_analyzer` |
| `POSTGRES_HOST` | PostgreSQL host | `db` |
| `POSTGRES_PORT` | PostgreSQL port | `5432` |

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
| `KNX_ALLOW_WRITE` | Allow writing to the bus (Write-to-Bus panel, and MCP bus tools in `read-write` mode). Only effective in standalone mode with a live connection. | `true` |
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
| `APP_IMAGE` | Docker image to pull (Prod Stack only) | `ghcr.io/martinhoefling/spectrumknx:latest` |
| `MCP_MODE` | MCP server for AI agents at `/mcp`: `off`, `read-only`, or `read-write`. See [MCP Server](#7-mcp-server-ai-agents). | `read-only` |

---

## 6. KNX Secure Keys

Spectrum KNX supports **KNX IP Secure** (both Tunneling and Routing) via `.knxkeys` files exported from ETS.

### 6.1 Auto-Detection

When `KNX_KNXKEYS_FILE` is **not** set, the daemon automatically looks for a keyfile at the default path:

```
/project/knx_keys.knxkeys
```

The password is read from:

```
/project/knx_keys_password
```

This means you can simply place the files at those paths (or upload them via the UI) without any environment variable configuration.

### 6.2 Upload via Web UI

If the `KNX_KNXKEYS_FILE` environment variable is **not** set, the Spectrum KNX UI provides an upload wizard accessible from **Settings → KNX Security Keys**:

1. Open the Spectrum KNX web interface.
2. Navigate to **Settings** (via the dropdown menu).
3. Click **Upload / Replace KNX Keys File (.knxkeys)**.
4. Select the `.knxkeys` file exported from ETS and enter the password.
5. Click **Upload & Apply**.

The backend will immediately **reconnect** to the KNX bus using the new credentials. No restart is required.

### 6.3 Hot-Reload

The daemon watches the knxkeys file for changes every 60 seconds. If the file is replaced on disk (e.g., via a volume mount update or a new upload), the daemon will automatically:

1. Detect the file modification
2. Disconnect from the KNX bus
3. Rebuild the secure configuration
4. Reconnect with the new credentials

### 6.4 Secure Configuration Priority

If multiple security methods are configured simultaneously, the daemon uses the following priority:

1. **`.knxkeys` file** — highest priority. If a keyfile is present (via env var or auto-detected), all other manual secure variables are ignored.
2. **Backbone Key** (`KNX_SECURE_BACKBONE_KEY`) — used for Secure Routing if no keyfile is present.
3. **Manual Tunneling Credentials** (`KNX_SECURE_USER_ID` + `KNX_SECURE_USER_PASSWORD`) — lowest priority.

Conflicts are logged as warnings.

---

## 7. MCP Server (AI Agents)

Spectrum KNX ships a built-in [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) server so AI agents — Claude Desktop, Cursor, and other MCP clients — can query
your KNX data in natural language. It is mounted at **`/mcp`** over the Streamable HTTP
transport, on the same host and port as the web UI and REST API.

### 7.1 Enabling it

The server is controlled by the `MCP_MODE` environment variable:

| `MCP_MODE` | Behaviour |
|---|---|
| `off` | Endpoint is not mounted. |
| `read-only` *(default)* | Query and introspection tools only — never writes to the bus. |
| `read-write` | Additionally enables tools that transmit on the bus (group value read/write). |

```bash
# .env
MCP_MODE=read-only
```

When enabled, the endpoint is served at `http://<host>:<BIND_PORT>/mcp` (default port
`8765`).

> ⚠️ **Enabled by default and unauthenticated.** With `MCP_MODE` unset the server runs
> in `read-only` mode, so `/mcp` is exposed out of the box, and the endpoint has **no
> authentication** — anyone who can reach it can call its tools. Expose it only on a
> trusted network, or behind a reverse proxy / VPN that enforces access control. Set
> `MCP_MODE=off` to disable it entirely. In `read-write` mode an agent can send
> telegrams onto your KNX bus, so turn it on deliberately.

### 7.2 Available tools

**Read-only** (available in both `read-only` and `read-write` modes):

*Telegram store:*

| Tool | Description |
|---|---|
| `query_telegrams` | Search stored telegrams by time range, source/destination, type, direction and DPT (paginated). |
| `get_last_values` | The most recent telegram for each group address. |
| `get_store_stats` | Telegram count, covered time range, on-disk size, backend and retention. |
| `get_store_capabilities` | What the storage backend supports (time range, pagination, size, …). |
| `count_telegrams` | Total number of stored telegrams. |

*ETS project* (requires a loaded `.knxproj`):

| Tool | Description |
|---|---|
| `get_project_info` | Project name, tool version and object counts. |
| `list_group_addresses` | Group addresses with names and DPTs (paginated, filterable). |
| `describe_group_address` | Full detail for a single group address. |
| `list_devices` | Devices in the project (paginated, filterable). |
| `list_communication_objects` | Communication objects and their group-address links. |
| `get_topology` | Area / line / device topology. |
| `list_locations` | Building structure (buildings, floors, rooms). |
| `list_functions` | ETS functions / functional blocks (paginated, filterable). |
| `describe_function` | Detail for a single function, including its group-address roles. |

*DPT & connection:*

| Tool | Description |
|---|---|
| `list_dpts` | Known data point types (filter by main type or free text). |
| `describe_dpt` | Detail for a DPT — unit, range, enum options, complex-type schema. |
| `encode_value` | Encode a Python value with a DPT into its raw payload bytes. |
| `decode_payload` | Decode raw payload bytes (or an integer for 6-bit DPTs) with a DPT. |
| `get_connection_status` | Current KNX connection state. |
| `get_server_config` | SpectrumKNX connection and security configuration (secrets masked). |

**Read-write** (`MCP_MODE=read-write` only) additionally exposes tools that read and
write group values on the live bus. They require an active bus connection, and the
write tools also need `KNX_ALLOW_WRITE=true` (see [KNX Settings](#knx-settings)).

| Tool | Description |
|---|---|
| `read_group_value` | Read a group address from the bus (sends a `GroupValueRead`, waits, DPT-decodes the response). |
| `send_group_value_read` | Queue a `GroupValueRead` on the bus (fire-and-forget). |
| `send_group_value_write` | Write a value to a group address (queues a DPT-encoded `GroupValueWrite`). |

> Project resources and canned prompts are still landing; the tables above list the
> tools available today.

### 7.3 Connecting a client

Point any MCP client that speaks **Streamable HTTP** at the endpoint URL. For example,
a Cursor / generic `mcp.json`:

```json
{
  "mcpServers": {
    "spectrum-knx": {
      "url": "http://<host>:8765/mcp"
    }
  }
}
```

For clients that only speak stdio (for example Claude Desktop), bridge with
[`mcp-remote`](https://github.com/geelen/mcp-remote):

```json
{
  "mcpServers": {
    "spectrum-knx": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://<host>:8765/mcp"]
    }
  }
}
```

Once connected, the client lists the tools above and can call them — for example
_"how many telegrams are stored and over what period?"_ or _"show the last value for
every light group address."_
