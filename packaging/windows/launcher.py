"""Windows launcher for Spectrum KNX (PyInstaller entry point).

Configuration precedence (highest wins):
  1. variables already set in the process environment
  2. the .env file next to the executable (created from env.template on
     first run)
  3. built-in defaults: SQLite database and uploaded project file in
     %LOCALAPPDATA%/SpectrumKNX

The environment must be finalized *before* importing the backend — modules
like database.py read it at import time.
"""

import os
import shutil
import sys
import threading
import webbrowser
from pathlib import Path

if getattr(sys, "frozen", False):
    EXE_DIR = Path(sys.executable).parent
else:
    # Dev convenience: run from a repo checkout (backend on sys.path)
    EXE_DIR = Path(__file__).parent
    sys.path.insert(0, str(Path(__file__).parents[2] / "backend"))

ENV_FILE = EXE_DIR / ".env"
# Bundled data files live in _internal (sys._MEIPASS) in a onedir build
ENV_TEMPLATE = Path(getattr(sys, "_MEIPASS", EXE_DIR)) / "env.template"


def prepare_environment() -> None:
    if not ENV_FILE.exists() and ENV_TEMPLATE.exists():
        shutil.copy(ENV_TEMPLATE, ENV_FILE)
        print(f"Created config file: {ENV_FILE}")

    from dotenv import load_dotenv

    load_dotenv(ENV_FILE)

    # Release version is baked in as a VERSION data file by the CI build
    version_file = Path(getattr(sys, "_MEIPASS", EXE_DIR)) / "VERSION"
    if version_file.exists():
        os.environ.setdefault("APP_VERSION", version_file.read_text().strip())

    data_dir = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "SpectrumKNX"
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{(data_dir / 'spectrum-knx.db').as_posix()}")
    os.environ.setdefault("KNX_PROJECT_PATH", str(data_dir / "knx_project.knxproj"))


def open_browser_when_up(url: str) -> None:
    import time
    import urllib.request

    for _ in range(40):
        try:
            urllib.request.urlopen(url, timeout=1)
            webbrowser.open(url)
            return
        except Exception:
            time.sleep(0.5)


def run() -> None:
    prepare_environment()

    host = os.environ.get("BIND_HOST", "127.0.0.1")
    port = int(os.environ.get("BIND_PORT", "8000"))

    import uvicorn
    from main import app

    url = f"http://{'localhost' if host in ('0.0.0.0', '127.0.0.1') else host}:{port}"
    print(f"Spectrum KNX — web interface: {url} (Ctrl+C to stop)")
    threading.Thread(target=open_browser_when_up, args=(url,), daemon=True).start()

    uvicorn.run(app, host=host, port=port, log_level=os.environ.get("LOG_LEVEL", "info").lower())


if __name__ == "__main__":
    run()
