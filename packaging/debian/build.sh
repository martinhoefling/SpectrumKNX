#!/bin/bash
# Build the spectrum-knx .deb. Meant to run inside a debian:trixie container
# (or any Debian/Ubuntu with python3 >= 3.13, python3-venv and dpkg-dev) so the
# bundled venv matches the target distro's interpreter.
#
# Prerequisites: the frontend must be built (frontend/dist). Usage:
#   packaging/debian/build.sh <version>        # e.g. 1.10.0 (no leading v)
# Output: dist/spectrum-knx_<version>_<arch>.deb
set -euo pipefail

VERSION="${1:?usage: build.sh <version>}"
VERSION="${VERSION#v}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKGDIR="$REPO_ROOT/packaging/debian"
ARCH="$(dpkg --print-architecture)"
STAGING="$(mktemp -d)"
VENV_PATH="/opt/spectrum-knx/venv"
trap 'rm -rf "$STAGING"' EXIT

[ -f "$REPO_ROOT/frontend/dist/index.html" ] || {
    echo "frontend/dist missing — run 'npm run build' in frontend/ first" >&2
    exit 1
}

echo "==> Creating venv at $VENV_PATH (final runtime path)"
rm -rf "$VENV_PATH"
mkdir -p /opt/spectrum-knx
python3 -m venv "$VENV_PATH"
"$VENV_PATH/bin/pip" install --quiet --upgrade pip

echo "==> Installing runtime dependencies (direct deps from pyproject, pinned by requirements.txt)"
DEPS=$(python3 -c "
import tomllib
with open('$REPO_ROOT/backend/pyproject.toml', 'rb') as f:
    print(' '.join(tomllib.load(f)['project']['dependencies']))
")
# shellcheck disable=SC2086
"$VENV_PATH/bin/pip" install --quiet --no-cache-dir \
    --constraint "$REPO_ROOT/backend/requirements.txt" $DEPS
"$VENV_PATH/bin/pip" uninstall --quiet --yes pip

echo "==> Staging package tree"
APP="$STAGING/opt/spectrum-knx/app"
mkdir -p "$APP" "$STAGING/etc/spectrum-knx" "$STAGING/usr/lib/systemd/system" "$STAGING/DEBIAN"

cp "$REPO_ROOT"/backend/*.py "$APP/"
rm -f "$APP/seed_data.py" "$APP/benchmark_is_in_delta.py"
cp -r "$REPO_ROOT/frontend/dist" "$APP/static"
# -a preserves the venv's symlinks (bin/python -> /usr/bin/python3)
cp -a "$VENV_PATH" "$STAGING/opt/spectrum-knx/venv"

cp "$PKGDIR/spectrum-knx.env" "$STAGING/etc/spectrum-knx/spectrum-knx.env"
sed "s/@VERSION@/$VERSION/" "$PKGDIR/spectrum-knx.service" \
    > "$STAGING/usr/lib/systemd/system/spectrum-knx.service"

sed -e "s/@VERSION@/$VERSION/" -e "s/@ARCH@/$ARCH/" "$PKGDIR/control.in" \
    > "$STAGING/DEBIAN/control"
echo "/etc/spectrum-knx/spectrum-knx.env" > "$STAGING/DEBIAN/conffiles"
install -m 0755 "$PKGDIR/postinst" "$PKGDIR/prerm" "$PKGDIR/postrm" "$STAGING/DEBIAN/"

# Normalize: no pyc caches, no root-squash surprises
find "$STAGING" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true

echo "==> Building .deb"
mkdir -p "$REPO_ROOT/dist"
OUT="$REPO_ROOT/dist/spectrum-knx_${VERSION}_${ARCH}.deb"
dpkg-deb --build --root-owner-group "$STAGING" "$OUT"
echo "==> Built $OUT"
