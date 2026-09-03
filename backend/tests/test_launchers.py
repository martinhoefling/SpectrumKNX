"""Guards over how the app is launched (#453).

`uvicorn` enables ProxyHeadersMiddleware by default, with `forwarded_allow_ips`
falling back to 127.0.0.1 — so a caller on loopback can set X-Forwarded-For and
have `scope["client"]` rewritten. Authentication identifies Home Assistant
ingress by exactly that address (`auth.is_ingress_peer`), so the launchers must
disable proxy headers explicitly rather than relying on a default.

These are file assertions rather than request assertions on purpose:
ProxyHeadersMiddleware wraps `config.loaded_app` at serve time, not the `app`
object, so a TestClient request never passes through it and cannot detect this.
"""

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

# Every place the application is started.
LAUNCHERS = [
    "Dockerfile",
    "backend/Dockerfile",
    "ha-addon/rootfs/etc/services.d/spectrum_knx/run",
    "packaging/debian/spectrum-knx.service",
    "packaging/windows/launcher.py",
    ".github/workflows/release.yml",
]


@pytest.mark.parametrize("relative_path", LAUNCHERS)
def test_launcher_disables_proxy_headers(relative_path):
    path = REPO_ROOT / relative_path
    assert path.is_file(), f"{relative_path} moved — update this list, do not delete the check"
    contents = path.read_text(encoding="utf-8")

    # Either the CLI flag or the keyword argument, depending on how it starts.
    disabled = "--no-proxy-headers" in contents or "proxy_headers=False" in contents
    assert disabled, (
        f"{relative_path} starts uvicorn without disabling proxy headers. "
        "X-Forwarded-For would then be trusted from loopback and could rewrite the "
        "peer address that the Home Assistant ingress bypass is decided on (#453)."
    )

    # A widened allow-list re-opens it even with the flag present.
    assert "--forwarded-allow-ips" not in contents, (
        f"{relative_path} widens forwarded_allow_ips; see auth.is_ingress_peer before doing this."
    )


def test_no_launcher_is_missed():
    """If a new way to start the app appears, it needs adding to LAUNCHERS."""
    found = set()
    for path in REPO_ROOT.rglob("*"):
        if not path.is_file() or "node_modules" in path.parts or ".git" in path.parts:
            continue
        if path.suffix not in ("", ".py", ".yml", ".yaml", ".service", ".sh") and path.name != "Dockerfile":
            continue
        if "venv" in path.parts or "test_launchers.py" in path.name:
            continue
        try:
            contents = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if "uvicorn main:app" in contents or "uvicorn.run(" in contents:
            found.add(str(path.relative_to(REPO_ROOT)))

    unknown = found - set(LAUNCHERS)
    assert not unknown, f"new uvicorn launch site(s) not covered by the proxy-header check: {sorted(unknown)}"
