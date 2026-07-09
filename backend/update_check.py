"""Best-effort update check against the project's GitHub releases.

Fetches the release list from GitHub, compares the newest release to the
running version, and reports the release notes for everything in between so the
frontend can show a "what changed" popup. Results are cached in memory and all
network errors are swallowed — a failed check simply reports "no update".

Disabled entirely when UPDATE_CHECK is not "true" (privacy/offline opt-out): no
outbound request is made.
"""

import asyncio
import logging
import os
import re
import time

import httpx

logger = logging.getLogger("update_check")

# Repo to check; overridable for forks. UPDATE_CHECK gates the outbound request.
GITHUB_REPO = os.getenv("GITHUB_REPO", "martinhoefling/SpectrumKNX")
UPDATE_CHECK_ENABLED = os.getenv("UPDATE_CHECK", "true").lower() == "true"

_CACHE_TTL = 6 * 60 * 60  # re-check GitHub at most every 6 hours
_ERROR_TTL = 15 * 60  # back off for 15 minutes after a failed check
_MAX_RELEASES = 10  # cap the notes we return if the install is far behind
_REQUEST_TIMEOUT = 10.0

_VERSION_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")

_cache: dict | None = None
_cache_expiry: float = 0.0
_lock = asyncio.Lock()


def _parse_version(value: str | None) -> tuple[int, int, int] | None:
    """Extract a (major, minor, patch) tuple from a version/tag string.

    Handles the various shapes the running version can take — "1.10.0",
    "v1.10.0", or a git-describe like "v1.10.0-3-gabc123" — by matching the
    first x.y.z it finds. Returns None when there's nothing to compare (e.g.
    a plain "dev" build), which callers treat as "can't tell → no update".
    """
    if not value:
        return None
    match = _VERSION_RE.search(value)
    if not match:
        return None
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def _is_newer(candidate: str | None, current: str | None) -> bool:
    """True when candidate is a strictly higher x.y.z than current."""
    parsed_candidate = _parse_version(candidate)
    parsed_current = _parse_version(current)
    if parsed_candidate is None or parsed_current is None:
        return False
    return parsed_candidate > parsed_current


async def _fetch_releases() -> list[dict]:
    """Fetch the recent releases for the repo from the GitHub API."""
    url = f"https://api.github.com/repos/{GITHUB_REPO}/releases?per_page=20"
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "SpectrumKNX-update-check",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()


def _build_info(current: str, releases: list[dict]) -> dict:
    """Assemble the update payload from the raw GitHub release list."""
    # GitHub returns releases newest-first. Keep only real, versioned releases.
    published = [
        r
        for r in releases
        if not r.get("draft") and not r.get("prerelease") and _parse_version(r.get("tag_name") or r.get("name"))
    ]

    latest = published[0] if published else None
    newer = [r for r in published if _is_newer(r.get("tag_name") or r.get("name"), current)]

    return {
        "enabled": True,
        "current": current,
        "latest": latest.get("tag_name") if latest else None,
        "update_available": bool(newer),
        "html_url": latest.get("html_url") if latest else None,
        "published_at": latest.get("published_at") if latest else None,
        "releases": [
            {
                "version": r.get("tag_name"),
                "name": r.get("name") or r.get("tag_name"),
                "notes": r.get("body") or "",
                "html_url": r.get("html_url"),
                "published_at": r.get("published_at"),
            }
            for r in newer[:_MAX_RELEASES]
        ],
    }


async def get_update_info(current: str) -> dict:
    """Return update status for the running version, using a cached result.

    Never raises: on a disabled check or any network/parse error it reports
    update_available=False so the UI just stays quiet.
    """
    if not UPDATE_CHECK_ENABLED:
        return {"enabled": False, "current": current, "update_available": False}

    global _cache, _cache_expiry
    now = time.monotonic()

    async with _lock:
        if _cache is not None and now < _cache_expiry:
            return _cache

        try:
            info = _build_info(current, await _fetch_releases())
            _cache, _cache_expiry = info, now + _CACHE_TTL
            return info
        except Exception as err:
            logger.warning("Update check failed: %s", err)
            fallback = {"enabled": True, "current": current, "update_available": False, "error": True}
            _cache, _cache_expiry = fallback, now + _ERROR_TTL
            return fallback


def _reset_cache() -> None:
    """Clear the in-memory cache (used by tests)."""
    global _cache, _cache_expiry
    _cache, _cache_expiry = None, 0.0
