from unittest.mock import AsyncMock, patch

import pytest

import update_check


def _release(tag, body="notes", *, prerelease=False, draft=False):
    return {
        "tag_name": tag,
        "name": tag,
        "body": body,
        "html_url": f"https://github.com/x/y/releases/tag/{tag}",
        "published_at": "2026-07-09T00:00:00Z",
        "prerelease": prerelease,
        "draft": draft,
    }


@pytest.fixture(autouse=True)
def _clear_cache():
    update_check._reset_cache()
    yield
    update_check._reset_cache()


@pytest.mark.parametrize(
    ("candidate", "current", "expected"),
    [
        ("v1.11.0", "1.10.0", True),
        ("1.10.1", "1.10.0", True),
        ("v1.10.0", "v1.10.0", False),
        ("1.9.0", "1.10.0", False),
        # git-describe build sitting on the latest tag is not "behind".
        ("v1.10.0", "v1.10.0-3-gabc123", False),
        ("v1.10.0", "dev", False),  # unparseable current → can't tell
    ],
)
def test_is_newer(candidate, current, expected):
    assert update_check._is_newer(candidate, current) is expected


def test_build_info_reports_newer_releases_with_notes():
    releases = [_release("v1.11.0", "big update"), _release("v1.10.1", "small fix"), _release("v1.10.0")]
    info = update_check._build_info("1.10.0", releases)

    assert info["update_available"] is True
    assert info["latest"] == "v1.11.0"
    assert [r["version"] for r in info["releases"]] == ["v1.11.0", "v1.10.1"]
    assert info["releases"][0]["notes"] == "big update"


def test_build_info_up_to_date():
    info = update_check._build_info("1.11.0", [_release("v1.11.0"), _release("v1.10.0")])
    assert info["update_available"] is False
    assert info["releases"] == []


def test_build_info_skips_prereleases_and_drafts():
    releases = [_release("v2.0.0-rc1", prerelease=True), _release("v1.99.0", draft=True), _release("v1.10.0")]
    info = update_check._build_info("1.10.0", releases)
    assert info["update_available"] is False
    assert info["latest"] == "v1.10.0"


@pytest.mark.parametrize(
    ("tag", "expected"),
    [
        ("v2.0.0-beta.6", True),
        ("2.0.0-rc1", True),
        ("v1.16.2", False),
        # A git-describe build is "past a stable tag", not a pre-release.
        ("v1.10.0-3-gabc123", False),
        ("dev", False),
    ],
)
def test_is_prerelease(tag, expected):
    assert update_check.is_prerelease(tag) is expected


@pytest.mark.parametrize(
    ("candidate", "current", "expected"),
    [
        # semver: a pre-release ranks below the stable release it precedes.
        ("v2.0.0-beta.6", "v2.0.0", False),
        ("v2.0.0", "v2.0.0-beta.6", True),
        ("v2.0.0-beta.7", "v2.0.0-beta.6", True),
        ("v2.0.0-beta.6", "v2.0.0-beta.7", False),
        # beta.10 > beta.9: numeric identifiers compare numerically, not as text.
        ("v2.0.0-beta.10", "v2.0.0-beta.9", True),
    ],
)
def test_is_newer_respects_prerelease_precedence(candidate, current, expected):
    assert update_check._is_newer(candidate, current) is expected


def test_stable_install_is_not_offered_a_beta_published_as_stable():
    """The 2.0.0 betas were all published with prerelease=false, which made the
    flag-only filter a no-op and offered betas to stable users (#427)."""
    releases = [_release("v2.0.0-beta.6"), _release("v1.16.2")]
    info = update_check._build_info("1.16.2", releases)

    assert info["update_available"] is False
    assert info["latest"] == "v1.16.2"
    assert info["channel"] == "stable"


def test_beta_install_keeps_getting_betas():
    releases = [_release("v2.0.0-beta.7"), _release("v2.0.0-beta.6"), _release("v1.16.2")]
    info = update_check._build_info("2.0.0-beta.6", releases)

    assert info["update_available"] is True
    assert info["latest"] == "v2.0.0-beta.7"
    assert [r["version"] for r in info["releases"]] == ["v2.0.0-beta.7"]
    assert info["channel"] == "beta"


def test_beta_install_is_offered_the_final_stable_release():
    releases = [_release("v2.0.0"), _release("v2.0.0-beta.6")]
    info = update_check._build_info("2.0.0-beta.6", releases)

    assert info["update_available"] is True
    assert info["latest"] == "v2.0.0"


def test_managed_by_reports_the_home_assistant_addon(monkeypatch):
    monkeypatch.setenv("SUPERVISOR_TOKEN", "token")
    info = update_check._build_info("1.16.2", [_release("v1.16.2")])
    assert info["managed_by"] == "home-assistant-addon"


def test_managed_by_is_none_outside_the_addon(monkeypatch):
    monkeypatch.delenv("SUPERVISOR_TOKEN", raising=False)
    info = update_check._build_info("1.16.2", [_release("v1.16.2")])
    assert info["managed_by"] is None


@pytest.mark.asyncio
async def test_get_update_info_disabled_makes_no_request():
    with patch.object(update_check, "UPDATE_CHECK_ENABLED", False):
        with patch.object(update_check, "_fetch_releases", new_callable=AsyncMock) as fetch:
            info = await update_check.get_update_info("1.10.0")
    assert info == {"enabled": False, "current": "1.10.0", "update_available": False}
    fetch.assert_not_called()


@pytest.mark.asyncio
async def test_get_update_info_caches_result():
    with patch.object(update_check, "UPDATE_CHECK_ENABLED", True):
        with patch.object(
            update_check, "_fetch_releases", new_callable=AsyncMock, return_value=[_release("v1.11.0")]
        ) as fetch:
            first = await update_check.get_update_info("1.10.0")
            second = await update_check.get_update_info("1.10.0")

    assert first["update_available"] is True
    assert second is first
    fetch.assert_called_once()  # second call served from cache


@pytest.mark.asyncio
async def test_get_update_info_swallows_errors():
    with patch.object(update_check, "UPDATE_CHECK_ENABLED", True):
        with patch.object(update_check, "_fetch_releases", new_callable=AsyncMock, side_effect=RuntimeError("boom")):
            info = await update_check.get_update_info("1.10.0")

    assert info["update_available"] is False
    assert info["error"] is True
