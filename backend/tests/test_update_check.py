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
