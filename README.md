# Spectrum KNX

<p align="center">
  <img src="frontend/public/logo.svg" alt="Spectrum KNX Logo" width="120" />
</p>

<p align="center">
  <em>An elegant, high-performance bus traffic monitor and visualizer for KNX Home Automation.</em>
</p>

![Spectrum KNX Dashboard](assets/dashboard.png)

Spectrum KNX is a dedicated tool to record, store, search, and visualize KNX bus telegrams indefinitely. Built for speed and reliability, it supports both a TimescaleDB backend for long-term time-series storage and a lightweight SQLite backend for simple setups — paired with a premium, real-time React web interface.

## 📺 Demo in Action

![Spectrum KNX Demo](assets/demo.webp)

## 🚀 Features

- **Live Group Monitor:** Monitor bus load, traffic rate, and instantaneous payloads in real-time.
- **Historical Analysis:** Search millions of past telegrams instantly with powerful backend query engines.
- **Time-Delta Context:** Automatically capture the events "before and after" a filtered event to debug logic faults.
- **Data Rendering:** Dynamically graph numerical readouts over time, grouped by physical unit types.
- **Zero Loss:** Pause the live feed without dropping packets—everything queues silently in the background buffer until you resume.
- **Database Maintenance:** Inspect database size, telegram count and covered time range; purge old telegrams with a dry-run preview and reclaim the freed disk space—right from the UI.
- **Home Assistant Companion Mode:** Run the analyzer directly on Home Assistant's own KNX telegram history—no second bus connection, no separate database.

## 🐳 Quick Start (Docker Compose)

The easiest way to run Spectrum KNX is with Docker Compose. This automatically provisions the TimescaleDB database alongside the KNX Tracker daemon.

1. Copy the example environment file: `cp .env_example .env`
2. Set your `KNX_PASSWORD`, `KNX_PROJECT_PATH` and `KNX_GATEWAY_IP` in `.env`.
3. Run the stack:

   **Development (Live Code):**
   ```bash
   docker-compose up -d
   ```

   **Production (Pre-built image):**
   ```bash
   docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
   ```

4. Access the web interface at `http://localhost:8000` (or `http://localhost:5173` in Dev mode).

## 📦 Debian Package & Windows

No Docker needed — both packages run Spectrum KNX with a local SQLite database
(no PostgreSQL) and are attached to every [GitHub release](https://github.com/martinhoefling/SpectrumKNX/releases):

- **Debian 13+ / compatible (amd64, arm64):** `sudo apt install ./spectrum-knx_<version>_<arch>.deb`,
  configure `/etc/spectrum-knx/spectrum-knx.env`, then `sudo systemctl restart spectrum-knx`.
  Web UI on port 8000.
- **Windows (x64):** unzip `spectrum-knx-<version>-windows-x64.zip`, run
  `spectrum-knx.exe` — the browser opens automatically; settings live in the
  `.env` file created next to the exe.

See [PACKAGING.md](PACKAGING.md) for details and [DEPLOYMENT.md](DEPLOYMENT.md)
for configuration.

## 🏠 Home Assistant

Two add-ons cover the two ways to run Spectrum KNX inside Home Assistant
(add this repository URL in *Settings → Add-ons → Add-on Store → Repositories*):

| | **Spectrum KNX** (standalone) | **Spectrum KNX (HA Companion)** |
|---|---|---|
| Bus connection | Own tunnel/routing connection to your KNX gateway | None — uses what HA already receives |
| Database | Own PostgreSQL/TimescaleDB or SQLite | Reads HA's KNX telegram database (read-only) |
| Live telegrams | Directly from the bus | Streamed from HA's websocket API |
| Retention & cleanup | Managed in Spectrum KNX (Database Maintenance screen) | Managed by Home Assistant |
| Use when… | You want an independent, full-featured recorder | You use HA's KNX integration and want its history analyzed without duplicating anything |

See [DEPLOYMENT.md](DEPLOYMENT.md) for installation and configuration of both.

### Detailed Guides
See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, [DEPLOYMENT.md](DEPLOYMENT.md) for production configuration, and the [Kubernetes templates](kubernetes/README.md) for cluster deployment.

## 🛠 Tech Stack
- **Backend:** Python 3.13+, FastAPI, `xknx`, WebSocket Streaming
- **Database:** PostgreSQL + TimescaleDB, or SQLite (via `aiosqlite`)
- **Frontend:** React, TypeScript, Vite, TanStack Table, uPlot

## 🤝 Contributing
Interested in building out new visualization blocks or analytical filters? See our [CONTRIBUTING.md](CONTRIBUTING.md) guide!

## 📜 License
Licensed under the GNU General Public License v3.0 (GPLv3). See [LICENSE](LICENSE) for details.
