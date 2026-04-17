# Contributing to Spectrum KNX

Thank you for your interest in making Spectrum KNX better!

## Development Requirements
- **Python 3.11+**
- **Node.js 18+ & npm**
- **Docker Compose** (for providing the local TimescaleDB instance)

## Setting up the Dev Environment

### 1. Database infrastructure
Spin up the local TimescaleDB instance in the background:
```bash
docker-compose up -d db
```

### 2. Backend (FastAPI / `xknx`)
Navigate to the `backend` directory and set up your virtual Python environment.
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Or `.\.venv\Scripts\Activate.ps1` on Windows
pip install -r requirements.txt
```
Run the local uvicorn server in auto-reload mode (runs on port 8000):
```bash
uvicorn main:app --reload
```

### 3. Frontend (React / Vite)
Open a separate terminal, navigate to the `frontend` directory, and install dependencies.
```bash
cd frontend
npm install
```
Start the Vite dev server (runs on port 5173):
```bash
npm run dev
```

> [!TIP]
> **API Proxying:** The Vite dev server is configured (via `vite.config.ts`) to automatically proxy any requests made to `/api` and `/ws` over to `localhost:8000`. This means you can develop the frontend logic at port 5173 and it will transparently communicate with your local python daemon. 

## Code Quality Standards
- **Python Linter:** We use `Ruff`. Run `ruff check .` before committing.
- **Frontend Linter:** We use `ESLint` and `Prettier`. Run `npm run lint` before committing.

## Submitting Pull Requests
- Ensure all CI tests pass.
- Write tests for new backend API endpoints or daemon loops.
- Keep commits isolated to specific features or bug fixes.
