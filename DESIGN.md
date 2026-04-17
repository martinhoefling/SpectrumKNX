# KNX Telegram Analyzer: System Design

> [!IMPORTANT]
> This document is the primary reference for all project specifications and functional design.
> It must be updated whenever new features or technical changes are defined.

The **KNX Telegram Analyzer** is an application designed to record, store, search, and visualize KNX bus telegrams. The goal is to provide a robust, long-term storage solution combined with a highly responsive, premium web frontend for real-time and historical data analysis.

---

## 1. System Architecture & Tech Stack

The system follows a standard modern client-server architecture with real-time streaming capabilities.

### Backend (Python/FastAPI)
- **Language:** Python 3.11+
- **API Framework:** `FastAPI` logic for fast, modern, async REST endpoints.
- **KNX Integration:** 
  - `xknx` connects asynchronously to the KNX IP router/interface to receive telegrams.
  - `xknxproject` parses ETS `.knxproj` files, allowing the app to resolve physical/group addresses into human-readable names and properly decode DPT (Data Point Type) payloads.
- **Real-Time Streaming:** A WebSocket manager (`ws_manager.py`) broadcasts all received telegrams to connected UI clients instantly.

### Storage (PostgreSQL + TimescaleDB)
- **Database Engine:** PostgreSQL with the TimescaleDB extension, optimized for heavy time-series workloads and large-scale data retention.
- **Data Volume Expectations:** ~5,000 telegrams/hour (~120,000/day, ~43.8 million/year). Expected uncompressed text size is ~10MB/day (~3.6GB/year).
- **Core Schema (`telegrams` hypertable):**
  - `timestamp`: The primary time column (TimescaleDB hypertable index).
  - `source_address`: e.g., "1.1.1" (Individual Address).
  - `target_address`: e.g., "1/2/3" (Group Address).
  - `telegram_type`: "GroupValueWrite", "GroupValueRead", "GroupValueResponse".
  - `dpt_main` & `dpt_sub`: Decoded Data Point Type identifiers.
  - `value_numeric` & `value_json`: Stored metrics and strings (JSONB handles complex KNX types like RGB or Date/Time).
  - `raw_data`: Hex encoded raw data sequence.

### Frontend (React + Vite)
- **Framework:** React + Vite, written in **TypeScript** for safety.
- **Styling:** Vanilla CSS, designed with a premium, tech-focused dark-mode aesthetic.
- **Data Grid:** `TanStack Table` handles the high-performance rendering of 100,000+ row datasets using virtualization and efficient DOM updates.

---

## 2. Core Functionalities

### 2.1 Group Monitor (Live View)
The realtime interface for observing bus activity as it happens.
- **WebSocket Streaming:** Receives all telegrams from the backend without server-side filtering.
- **In-Memory Filtering:** Filters are applied locally in the browser to ensure zero latency and preserve the integrity of the downloaded cache.
- **Live/Pause Buffer:** The view can be paused. Incoming telegrams are non-destructively queued in a background buffer to prevent data loss. Resuming flushes the buffer into the visible array.
- **Rate Estimator:** Calculates the live bus load. Cycles interactively through `msg/s`, `msg/min`, and `msg/h` using a sliding time window.
- **Status Telemetry:** Displays connected status, current rate, loaded rows, and buffered elements.

### 2.2 History Search
The interface for deep-diving into historical bus traces.
- **Query Building:** Uses the same Filter Panel as the live view, but applies the parameters server-side via SQL `IN(...)` clauses.
- **Time Loaders:** 
  - *Quick Range / Relative:* Unified loader (seconds, minutes, hours, days) counting backwards from the present.
  - *Absolute:* Custom HTML5 date/time pickers for exact start and end bounds.
- **Safe Loading Limits:** Implements backend hard-limits (e.g., max 25k rows per fetch) with visual warnings if a search boundary hits the ceiling.

### 2.3 Advanced Filtering & Context Windows
A unified side panel used across both Live and History views, dynamically populated from the `.knxproj` definition.

- **Categories:** `Source`, `Target`, `Type`, and `DPT`.
- **Searchable:** A local search bar quickly narrows down long lists of available items before selecting them.
- **Logical Rules:**
  - *Empty Category* = Pass-through (no restriction).
  - *Within Category* = **OR** logic (checking multiple sources shows telegrams from any of them).
  - *Across Categories* = **AND** logic (telegrams must pass all active categorical subsets).
- **Time-Delta Context Window (Burst Feature):**
  - Allows specifying independent `- Before (ms)` and `+ After (ms)` times.
  - If a telegram matches the filter, *all* other telegrams within that surrounding time window are forcefully included—even if they wouldn't normally pass the filter.
  - Useful for debugging causational events (e.g., what caused a physical switch to broadcast).

### 2.4 Shared UI Components & Deduplication
- **TelegramTable:** Both views mount the identical underlying table engine, guaranteeing feature parity (sorting, column toggling) between live and historical inspection.
- **Timestamp Deduplication:** Prevent visual and analytical artifacts by safely discarding telegrams that arrive with identical millisecond timestamps via overlapping historical loads and live streams.

### 2.6 Visualization Layer (Plotting)
A dedicated visualization mode built to render both `live` and `history` data sets visually against time.
- **Data Source Selection:** The plotting engine takes the locally loaded/filtered dataset (either from the Live Monitor buffer or the History Search) as its input.
- **Target Selection:** A side-panel uses the same component as the `FilterPanel` to allow selecting specific targets (Group Addresses). It displays count bubbles derived from the current dataset so the user knows if enough data frames are available for a meaningful plot.
- **Dynamic Grouping by Unit:** Plots are dynamically generated and grouped by their physical unit (e.g., `°C`, `W`, `%`). 
  - All targets with the same unit are combined into a single line chart with a shared Y-axis (or multiple Y-axes if appropriate).
  - The `binary` (boolean) type is treated as a special unit and grouped into a dedicated discrete state timeline plot (displaying ON/OFF state blocks), matching the visual style of Home Assistant.
- **Synchronized Time Axis (X-Axis):** 
  - Supported plots are strictly time-series (X-axis is always time).
- **Initial State Rendering (Future Enhancement):** 
  - Since KNX is event-driven, the initial value of a group address might not be present within the currently loaded time window. 
  - A backend feature will be implemented in the future to query the *last known value* of a set of group addresses at a specific timestamp (the start of the loaded window) to ensure continuous plots and binary timelines are never "unknown" at their starting edge.
  - Until this backend feature is ready, plots will pick up dynamically from the first recorded event in the window.

### 2.7 User Settings & Persistence
User preferences are persisted locally using cookies:
- Selected Load Limit
- Selected Bus Rate unit (s/m/h)
- Column visibility toggles (e.g., hiding Raw Data or DPT columns)

---

## 3. Implementation Plan (Development State)

The following checklist tracks the phased rollout of the architecture defined above.

### Phase 1: Backend Foundation & Database
- [x] **Database Schema:** Create Docker Compose setup with TimescaleDB and `init.sql` script to create hypertables.
- [x] **KNX Listener Server:** A Python daemon using `xknx` connects to the real KNX setup.
- [x] **Storage Engine:** The listener decodes telegrams and writes them to PostgreSQL.

### Phase 2: API Layer & Project Parser
- [x] **Search & Filter Endpoints:** API routes that support complex history queries.
- [x] **WebSocket Publisher:** API route `/ws/telegrams` that broadcasts live telegrams.
- [x] **Pagination:** Implementing cursor or offset based pagination for the UI.
- [x] **Project Parser:** Functionality to load an ETS `.knxproj` and serve logical names to the UI.

### Phase 3: Frontend Development
- [x] **Core Table Component:** Implement the reusable `TelegramTable` using TanStack Table.
- [x] **Live Monitor Dashboard:** Implement real-time monitoring with play/pause buffering and live bus rate estimation.
- [x] **History Search Interface:** Develop the relative time loader and custom range pickers.
- [x] **Shared State & Persistence:** Implement cookie-based persistence for user settings.

### Phase 4: Data Quality & Visualization
- [x] **Telegrams Deduplication:** Implement frontend/backend logic to handle identical timestamp collisions.
- [x] **Visualization Layer:** Adding charts (e.g., uPlot or Recharts) to plot specific group address values and bus load over time.

### Phase 5: Filtering & Grouping
- [x] **`GET /api/filter-options` Endpoint:** New endpoint serving project-derived filter option lists.
- [x] **Multi-value Filter Params:** Extend `GET /api/telegrams` to accept comma-separated lists for source, target, type, and DPT filters.
- [x] **Time-Delta Context Window (Backend):** SQL query expansion to include rows within ±Nms of matching rows.
- [x] **`FilterPanel` Component:** New collapsible side panel with search bar, category sections, checkboxes, and count bubbles.
- [x] **Live Monitor Integration:** Frontend in-memory filtering + time-delta context window applied to loaded telegrams.
- [x] **History Search Integration:** Filter state drives backend query params at load time.
- [x] **WebSocket Architecture:** `ws_manager.py` broadcasts all telegrams unfiltered; live filtering is entirely frontend-only.
