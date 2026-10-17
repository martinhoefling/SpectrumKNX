import asyncio
import contextlib
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from xknx.core import XknxConnectionState
from xknx.dpt import DPTBinary
from xknx.exceptions import CommunicationError
from xknx.telegram import Telegram as XknxTelegram
from xknx.telegram import TelegramDirection
from xknx.telegram.address import GroupAddress, IndividualAddress

from knx_daemon import process_telegram_async, telegram_received_cb


async def _cleanup_daemon_tasks():
    """Cancel and clear the background tasks knx_startup leaves running."""
    import knx_daemon

    for task in (knx_daemon._connect_task, knx_daemon._watch_task):
        if task and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    knx_daemon._connect_task = None
    knx_daemon._watch_task = None


@pytest.mark.asyncio
@patch("knx_daemon.store.store", new_callable=AsyncMock)
@patch("knx_daemon.manager.broadcast", new_callable=AsyncMock)
@patch("knx_daemon.parse_telegram_payload")
async def test_process_telegram_async(mock_parse, mock_broadcast, mock_store):
    # Setup mocks

    # Mock parse_telegram_payload return value
    # value_numeric, value_json, raw_data, dpt_str, dpt_main, dpt_sub, unit, value_formatted, raw_hex
    mock_parse.return_value = (1.0, True, b"\x01", "1.001", 1, 1, "on/off", "On", "01")

    # Create a dummy xknx telegram received from the bus
    telegram = XknxTelegram(
        source_address=IndividualAddress("1.1.1"),
        destination_address=GroupAddress("1/1/1"),
        payload=DPTBinary(1),
        direction=TelegramDirection.INCOMING,
    )

    # Run the function
    await process_telegram_async(telegram)

    # Verify DB insertion
    assert mock_store.called
    stored_telegram = mock_store.call_args[0][0]
    assert stored_telegram.source == "1.1.1"
    assert stored_telegram.destination == "1/1/1"
    assert stored_telegram.value == 1.0

    # Verify WebSocket broadcast
    assert mock_broadcast.called
    args, _ = mock_broadcast.call_args
    broadcast_data = args[0]

    assert broadcast_data["source_address"] == "1.1.1"
    assert broadcast_data["target_address"] == "1/1/1"
    assert broadcast_data["value_numeric"] == 1.0
    assert broadcast_data["value_formatted"] == "On"
    # Incoming is the default direction for telegrams received from the bus.
    assert stored_telegram.direction == "Incoming"
    assert broadcast_data["direction"] == "Incoming"


@pytest.mark.asyncio
@patch("knx_daemon.store.store", new_callable=AsyncMock)
@patch("knx_daemon.manager.broadcast", new_callable=AsyncMock)
@patch("knx_daemon.parse_telegram_payload")
async def test_process_telegram_async_outgoing_is_stored(mock_parse, mock_broadcast, mock_store):
    """Telegrams we send to the bus (#161) are stored and broadcast as Outgoing."""
    mock_parse.return_value = (1.0, True, b"\x01", "1.001", 1, 1, "on/off", "On", "01")

    telegram = XknxTelegram(
        source_address=IndividualAddress("1.1.1"),
        destination_address=GroupAddress("1/1/1"),
        payload=DPTBinary(1),
        direction=TelegramDirection.OUTGOING,
    )

    await process_telegram_async(telegram)

    assert mock_store.called
    stored_telegram = mock_store.call_args[0][0]
    assert stored_telegram.direction == "Outgoing"

    assert mock_broadcast.called
    broadcast_data = mock_broadcast.call_args[0][0]
    assert broadcast_data["direction"] == "Outgoing"


@patch("knx_daemon.asyncio.get_running_loop")
@patch("knx_daemon.process_telegram_async")
def test_telegram_received_cb(mock_process, mock_get_loop):
    # Setup mocks
    mock_loop = MagicMock()
    mock_get_loop.return_value = mock_loop

    telegram = MagicMock(spec=XknxTelegram)

    # Run the callback
    telegram_received_cb(telegram)

    # Verify task creation
    assert mock_loop.create_task.called


@pytest.mark.asyncio
@patch("knx_daemon.store.check_connection")
@patch("knx_daemon.store.initialize")
@patch("knx_daemon.store.start")
@patch("knx_daemon._load_project_data")
@patch("knx_daemon.XKNX")
@patch("knx_daemon._watch_files", new_callable=AsyncMock)
async def test_knx_startup_success(
    mock_watch_files, mock_xknx, mock_load_project, mock_store_start, mock_store_init, mock_check_conn
):
    from knx_telegram_store.connection import ConnectionCheckResult

    import knx_daemon

    mock_check_conn.return_value = ConnectionCheckResult.success()
    mock_xknx_instance = MagicMock()
    mock_xknx.return_value = mock_xknx_instance
    mock_xknx_instance.start = AsyncMock()

    from knx_daemon import knx_startup

    try:
        with patch("knx_daemon.global_knx_project", None):
            await knx_startup()
            await knx_daemon._connect_task

        mock_check_conn.assert_called_once()
        mock_store_init.assert_called_once()
        mock_store_start.assert_called_once()
        mock_xknx_instance.start.assert_called_once()
        # The received callback must also fire for outgoing telegrams so sent
        # telegrams are stored/broadcast (#161).
        _, kwargs = mock_xknx_instance.telegram_queue.register_telegram_received_cb.call_args
        assert kwargs.get("match_for_outgoing") is True
        # Connection state changes are observed for the websocket status push (#166)
        assert mock_xknx_instance.connection_manager.register_connection_state_changed_cb.called
        mock_watch_files.assert_called_once()
    finally:
        await _cleanup_daemon_tasks()


@pytest.mark.asyncio
@patch("knx_daemon.store.check_connection")
@patch("knx_daemon.store.initialize")
@patch("knx_daemon.store.start")
@patch("knx_daemon._load_project_data")
@patch("knx_daemon.XKNX")
@patch("knx_daemon._watch_files", new_callable=AsyncMock)
@patch("knx_daemon.asyncio.sleep", new_callable=AsyncMock)
async def test_knx_startup_retries_until_connected(
    mock_sleep, mock_watch_files, mock_xknx, mock_load_project, mock_store_start, mock_store_init, mock_check_conn
):
    """A failed initial connect is retried with a fresh instance until it succeeds (#166)."""
    from knx_telegram_store.connection import ConnectionCheckResult

    import knx_daemon

    mock_check_conn.return_value = ConnectionCheckResult.success()
    failing_instance = MagicMock()
    failing_instance.start = AsyncMock(side_effect=CommunicationError("gateway unreachable"))
    failing_instance.stop = AsyncMock()
    ok_instance = MagicMock()
    ok_instance.start = AsyncMock()
    mock_xknx.side_effect = [failing_instance, ok_instance]

    from knx_daemon import knx_startup

    try:
        with patch("knx_daemon.global_knx_project", None):
            await knx_startup()
            await knx_daemon._connect_task

        failing_instance.start.assert_called_once()
        failing_instance.stop.assert_called_once()
        ok_instance.start.assert_called_once()
        assert knx_daemon.xknx_instance is ok_instance
    finally:
        await _cleanup_daemon_tasks()


@pytest.mark.asyncio
@patch("knx_daemon.store.check_connection")
@patch("knx_daemon.store.initialize")
@patch("knx_daemon.store.start")
@patch("knx_daemon._load_project_data")
@patch("knx_daemon.XKNX")
@patch("knx_daemon._watch_files", new_callable=AsyncMock)
async def test_knx_startup_watcher_runs_while_disconnected(
    mock_watch_files, mock_xknx, mock_load_project, mock_store_start, mock_store_init, mock_check_conn
):
    """The file watcher starts even when the bus cannot be reached (#166)."""
    from knx_telegram_store.connection import ConnectionCheckResult

    mock_check_conn.return_value = ConnectionCheckResult.success()
    mock_xknx_instance = MagicMock()
    mock_xknx.return_value = mock_xknx_instance
    mock_xknx_instance.start = AsyncMock(side_effect=CommunicationError("gateway unreachable"))
    mock_xknx_instance.stop = AsyncMock()

    from knx_daemon import knx_startup

    try:
        with patch("knx_daemon.global_knx_project", None):
            await knx_startup()
            await asyncio.sleep(0)

        mock_watch_files.assert_called_once()
    finally:
        await _cleanup_daemon_tasks()


@pytest.mark.asyncio
@patch("knx_daemon.store.stop", new_callable=AsyncMock)
async def test_knx_shutdown_cancels_background_tasks(mock_store_stop):
    import knx_daemon
    from knx_daemon import knx_shutdown

    connect_task = asyncio.create_task(asyncio.sleep(3600))
    watch_task = asyncio.create_task(asyncio.sleep(3600))
    mock_instance = MagicMock()
    mock_instance.stop = AsyncMock()

    knx_daemon._connect_task = connect_task
    knx_daemon._watch_task = watch_task
    with patch("knx_daemon.xknx_instance", mock_instance):
        await knx_shutdown()

    assert connect_task.cancelled()
    assert watch_task.cancelled()
    assert knx_daemon._connect_task is None
    assert knx_daemon._watch_task is None
    mock_instance.stop.assert_called_once()
    mock_store_stop.assert_called_once()


@pytest.mark.asyncio
@patch("knx_daemon.manager.broadcast_event", new_callable=AsyncMock)
async def test_connection_state_cb_broadcasts(mock_broadcast_event):
    import knx_daemon

    instance = MagicMock()
    knx_daemon._connection_log.reset()
    knx_daemon._register_connection_state_cb(instance)
    state_cb = instance.connection_manager.register_connection_state_changed_cb.call_args[0][0]

    with patch("knx_daemon.xknx_instance", instance):
        state_cb(XknxConnectionState.DISCONNECTED)
        await asyncio.sleep(0)

    mock_broadcast_event.assert_called_once()
    event = mock_broadcast_event.call_args[0][0]
    assert event["type"] == "connection_state"
    assert event["connected"] is False
    assert event["state"] == "disconnected"

    # Events from a replaced instance are ignored
    with patch("knx_daemon.xknx_instance", MagicMock()):
        state_cb(XknxConnectionState.CONNECTED)
        await asyncio.sleep(0)

    assert mock_broadcast_event.call_count == 1


@pytest.mark.asyncio
@patch("knx_daemon.store.check_connection")
@patch("knx_daemon.store.initialize")
async def test_knx_startup_db_failure(mock_store_init, mock_check_conn):
    from knx_telegram_store.connection import ConnectionCheckResult, ConnectionErrorKind

    mock_check_conn.return_value = ConnectionCheckResult.failure(
        ConnectionErrorKind.HOST_UNREACHABLE, "Database host is unreachable"
    )

    from knx_daemon import knx_startup

    with pytest.raises(RuntimeError, match="Database connection check failed"):
        await knx_startup()

    mock_check_conn.assert_called_once()
    mock_store_init.assert_not_called()


@pytest.mark.parametrize(
    ("payload", "dpt", "expected_type", "expected_value"),
    [
        (True, "1.001", "DPTBinary", True),
        (50, "5.001", "DPTArray", (0x80,)),
        (21.5, "9.001", "DPTArray", (0x0C, 0x33)),
        (1, None, "DPTBinary", 1),
        ([0x0C, 0x22], None, "DPTArray", (0x0C, 0x22)),
        ("12:30:00", "10.001", "DPTArray", (12, 30, 0)),
        ("2026-07-18", "11.001", "DPTArray", (18, 7, 26)),
        ("2026-07-18T12:30:00", "19.001", "DPTArray", (126, 7, 18, 12, 30, 0, 36, 0)),
    ],
)
def test_encode_payload(payload, dpt, expected_type, expected_value):
    from knx_daemon import _encode_payload

    encoded = _encode_payload(payload, dpt)
    assert type(encoded).__name__ == expected_type
    assert encoded.value == expected_value


def test_encode_payload_unknown_dpt_raises():
    from knx_daemon import _encode_payload

    with pytest.raises(ValueError, match="Unknown DPT"):
        _encode_payload(1, "999.999")


@pytest.mark.parametrize(
    ("allow_write", "connected", "expected"),
    [
        (True, True, True),
        (False, True, False),
        (True, False, False),
    ],
)
def test_write_enabled(allow_write, connected, expected):
    """Independent of the telegram store's read-only-ness (postgres-readonly can write)."""
    import knx_daemon

    with (
        patch.object(knx_daemon, "ALLOW_WRITE", allow_write),
        patch.object(knx_daemon, "is_connected", return_value=connected),
    ):
        assert knx_daemon.write_enabled() is expected


@pytest.mark.asyncio
async def test_send_group_value_queues_write_telegram():
    from xknx.telegram.apci import GroupValueWrite

    import knx_daemon

    fake = MagicMock()
    fake.current_address = IndividualAddress("1.1.1")
    fake.telegrams.put = AsyncMock()
    with patch.object(knx_daemon, "xknx_instance", fake):
        await knx_daemon.send_group_value("1/2/3", True, "1.001")

    fake.telegrams.put.assert_awaited_once()
    telegram = fake.telegrams.put.await_args.args[0]
    assert str(telegram.destination_address) == "1/2/3"
    assert isinstance(telegram.payload, GroupValueWrite)


@pytest.mark.asyncio
async def test_read_group_value_queues_read_telegram():
    from xknx.telegram.apci import GroupValueRead

    import knx_daemon

    fake = MagicMock()
    fake.current_address = IndividualAddress("1.1.1")
    fake.telegrams.put = AsyncMock()
    with patch.object(knx_daemon, "xknx_instance", fake):
        await knx_daemon.read_group_value("1/2/3")

    fake.telegrams.put.assert_awaited_once()
    telegram = fake.telegrams.put.await_args.args[0]
    assert str(telegram.destination_address) == "1/2/3"
    assert isinstance(telegram.payload, GroupValueRead)


@pytest.mark.asyncio
async def test_send_group_value_without_connection_raises():
    import knx_daemon

    with patch.object(knx_daemon, "xknx_instance", None):
        with pytest.raises(RuntimeError, match="Not connected"):
            await knx_daemon.send_group_value("1/2/3", True, "1.001")


def test_get_server_config_standalone_reports_mode():
    import knx_daemon

    with patch.object(knx_daemon, "STORE_MODE", "standalone"):
        config = knx_daemon.get_server_config()

    assert config["mode"] == "standalone"
    assert "gateway_ip" in config["connection"]
    assert "knxkeys_found" in config["files"]
    assert "telegram_store" not in config["status"]


def test_project_file_info_prefers_the_uploaded_filename(tmp_path):
    """Uploads all land on one fixed path, so the sidecar carries the name the
    user actually chose — which is what they use for versioning (#425)."""
    import json as _json

    import knx_daemon

    proj = tmp_path / "knx_project.knxproj"
    proj.write_bytes(b"x")
    (tmp_path / "knx_project_meta.json").write_text(
        _json.dumps({"original_filename": "Home-v42.knxproj", "imported_at": "2026-08-20T10:00:00+00:00"})
    )

    info = knx_daemon._project_file_info(str(proj))

    assert info["project_display_name"] == "Home-v42.knxproj"
    assert info["project_imported_at"] == "2026-08-20T10:00:00+00:00"


def test_project_file_info_falls_back_to_basename_and_mtime(tmp_path):
    """A project supplied via KNX_PROJECT_PATH has no sidecar, but its own
    basename is already the real name and its mtime is when it arrived."""
    import knx_daemon

    proj = tmp_path / "MyHouse.knxproj"
    proj.write_bytes(b"x")

    info = knx_daemon._project_file_info(str(proj))

    assert info["project_display_name"] == "MyHouse.knxproj"
    assert info["project_imported_at"] is not None


def test_project_file_info_survives_a_corrupt_sidecar(tmp_path):
    """A damaged sidecar must not take down the settings screen."""
    import knx_daemon

    proj = tmp_path / "knx_project.knxproj"
    proj.write_bytes(b"x")
    (tmp_path / "knx_project_meta.json").write_text("{not json")

    info = knx_daemon._project_file_info(str(proj))

    assert info["project_display_name"] == "knx_project.knxproj"
    assert info["project_imported_at"] is not None


def test_project_file_info_reports_ets_metadata():
    """The ETS project's own name and modification date are distinct from when
    it was imported here, and are already parsed (#425)."""
    import knx_daemon

    project = {"info": {"name": "Musterhaus", "last_modified": "2026-07-01T08:00:00Z", "created_by": "ETS6"}}
    with patch.object(knx_daemon, "global_knx_project", project):
        info = knx_daemon._project_file_info(None)

    assert info["project_ets_name"] == "Musterhaus"
    assert info["project_ets_last_modified"] == "2026-07-01T08:00:00Z"
    assert info["project_created_by"] == "ETS6"
    assert info["project_loaded"] is True


def test_project_file_info_without_a_project():
    import knx_daemon

    with patch.object(knx_daemon, "global_knx_project", None):
        info = knx_daemon._project_file_info(None)

    assert info["project_loaded"] is False
    assert info["project_display_name"] is None
    assert info["project_ets_name"] is None


@pytest.mark.parametrize("feed_connected", [True, False])
def test_get_server_config_companion_reports_live_feed(feed_connected):
    """Sqlite companion mode must not report the daemon's bus connection (#184)."""
    import ha_live_bridge
    import knx_daemon

    with (
        patch.object(knx_daemon, "STORE_MODE", "external-readonly"),
        patch.object(ha_live_bridge, "_active_source", "ha_websocket"),
        patch.object(ha_live_bridge, "_connected", feed_connected),
    ):
        config = knx_daemon.get_server_config()

    assert config["mode"] == "companion"
    assert config["status"]["connected"] is feed_connected
    assert config["status"]["write_enabled"] is False
    assert config["connection"] == {"type": "HOME_ASSISTANT", "live_source": "ha_websocket"}
    # No gateway/security noise that doesn't apply in companion mode
    assert config["security"] == {}
    assert "knxkeys_found" not in config["files"]


@pytest.mark.parametrize("legacy", [True, False])
def test_get_server_config_companion_reports_legacy_timestamps(legacy):
    """The UI needs to know when Home Assistant's store is still pre-UTC (#462)."""
    import ha_live_bridge
    import knx_daemon

    with (
        patch.object(knx_daemon, "STORE_MODE", "external-readonly"),
        patch.object(ha_live_bridge, "_legacy_timestamps", legacy),
    ):
        config = knx_daemon.get_server_config()

    assert config["status"]["legacy_timestamps"] is legacy


@pytest.mark.parametrize("feed_connected", [True, False])
def test_get_server_config_postgres_readonly_reports_bus_and_store(feed_connected):
    """postgres-readonly reports a real bus connection (own daemon) alongside the shared store."""
    import knx_daemon
    import pg_listen_bridge

    with (
        patch.object(knx_daemon, "STORE_MODE", "postgres-readonly"),
        patch.object(knx_daemon, "is_connected", return_value=True),
        patch.object(knx_daemon, "write_enabled", return_value=True),
        patch.object(pg_listen_bridge, "_connected", feed_connected),
    ):
        config = knx_daemon.get_server_config()

    assert config["mode"] == "postgres-companion"
    # Same connection/security shape as standalone — it is our own bus connection.
    assert "gateway_ip" in config["connection"]
    assert "knxkeys_found" in config["files"]
    assert config["status"]["connected"] is True
    assert config["status"]["write_enabled"] is True
    assert config["status"]["telegram_store"] == "shared-postgres-readonly"
    assert config["status"]["live_source"] == "postgres-listen-notify"
    assert config["status"]["live_connected"] is feed_connected


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "sidecar,env_password,expected",
    [
        ("secret\n", None, "secret"),  # uploaded password is picked up
        ("secret", "from_env", "from_env"),  # KNX_PASSWORD still wins
        ("", None, None),  # unprotected project uploaded with an empty password
        (None, None, None),  # project file dropped in place by hand
    ],
)
async def test_load_project_reads_password_next_to_custom_path(monkeypatch, tmp_path, sidecar, env_password, expected):
    """With KNX_PROJECT_PATH set (the Windows and Debian default) the upload
    stores the password beside the project; the loader has to read it back."""
    import knx_daemon

    proj_file = tmp_path / "knx_project.knxproj"
    proj_file.write_bytes(b"dummy")
    if sidecar is not None:
        (tmp_path / "knx_project_password").write_text(sidecar, encoding="utf-8")
    monkeypatch.setenv("KNX_PROJECT_PATH", str(proj_file))
    if env_password:
        monkeypatch.setenv("KNX_PASSWORD", env_password)
    else:
        monkeypatch.delenv("KNX_PASSWORD", raising=False)
    monkeypatch.setattr(knx_daemon, "global_knx_project", None)
    monkeypatch.setattr(knx_daemon, "project_name_map", {"ga": {}, "ia": {}})
    monkeypatch.setattr(knx_daemon, "xknx_instance", None)

    with patch("xknxproject.XKNXProj") as mock_proj:
        mock_proj.return_value.parse.return_value = {"group_addresses": {}, "devices": {}}
        assert await knx_daemon._load_project_data() is True

    mock_proj.assert_called_once_with(str(proj_file), password=expected)


# ── Connection log during an outage (#504) ───────────────────────────────────


def _records(caplog):
    return [(r.levelname, r.getMessage()) for r in caplog.records if r.name == "knx_daemon"]


def test_an_outage_is_logged_once_not_per_retry(caplog):
    import logging

    import knx_daemon

    log = knx_daemon._ConnectionLog()
    C, D, K = XknxConnectionState.CONNECTING, XknxConnectionState.DISCONNECTED, XknxConnectionState.CONNECTED
    caplog.set_level(logging.INFO, logger="knx_daemon")

    assert log.handle(C, 0) == "connecting"
    assert log.handle(K, 1) == "connected"
    caplog.clear()

    # The tunnel drops; xknx retries every 3 seconds for five minutes.
    broadcasts = [log.handle(D, 10)]
    for attempt in range(100):
        broadcasts.append(log.handle(C, 13 + attempt * 3))
        broadcasts.append(log.handle(D, 14 + attempt * 3))

    assert _records(caplog) == [("WARNING", "KNX connection lost - reconnecting")]
    # Clients are told once and keep showing "disconnected".
    assert [b for b in broadcasts if b] == ["disconnected"]

    caplog.clear()
    assert log.handle(C, 320) is None
    assert log.handle(K, 321) == "connected"
    assert _records(caplog) == [("INFO", "KNX connection restored after 5m 11s (100 failed attempts)")]


def test_a_long_outage_is_mentioned_at_a_slow_interval(caplog):
    import logging

    import knx_daemon

    log = knx_daemon._ConnectionLog()
    C, D, K = XknxConnectionState.CONNECTING, XknxConnectionState.DISCONNECTED, XknxConnectionState.CONNECTED
    log.handle(K, 0)
    log.handle(D, 0)
    caplog.set_level(logging.INFO, logger="knx_daemon")
    caplog.clear()

    for second in range(3, 3600, 3):  # one hour of retries
        log.handle(C, second)
        log.handle(D, second + 1)

    messages = _records(caplog)
    assert len(messages) == 5  # every ten minutes, not 2400 lines
    assert all(level == "WARNING" and msg.startswith("KNX bus still unreachable after") for level, msg in messages)
    assert messages[0][1] == "KNX bus still unreachable after 10m 1s (200 failed attempts)"


def test_initial_connect_failures_count_as_one_outage(caplog):
    import logging

    import knx_daemon

    log = knx_daemon._ConnectionLog()
    C, D, K = XknxConnectionState.CONNECTING, XknxConnectionState.DISCONNECTED, XknxConnectionState.CONNECTED
    caplog.set_level(logging.INFO, logger="knx_daemon")

    broadcasts = [log.handle(C, 0), log.handle(D, 1)]
    for attempt in range(1, 6):
        broadcasts += [log.handle(C, attempt * 30), log.handle(D, attempt * 30 + 1)]
    broadcasts.append(log.handle(K, 200))

    assert [b for b in broadcasts if b] == ["connecting", "disconnected", "connected"]
    assert _records(caplog) == [
        ("INFO", "KNX connection state changed: CONNECTING"),
        ("INFO", "KNX connection state changed: DISCONNECTED"),
        ("INFO", "KNX connection restored after 3m 19s (6 failed attempts)"),
    ]


def test_a_deliberate_stop_is_not_reported_as_an_outage(caplog):
    import logging

    import knx_daemon

    log = knx_daemon._ConnectionLog()
    log.handle(XknxConnectionState.CONNECTED, 0)
    caplog.set_level(logging.INFO, logger="knx_daemon")
    caplog.clear()

    log.reset()
    assert log.handle(XknxConnectionState.DISCONNECTED, 1) == "disconnected"
    assert _records(caplog) == [("INFO", "KNX connection state changed: DISCONNECTED")]


def test_format_duration():
    import knx_daemon

    assert knx_daemon._format_duration(42.9) == "42s"
    assert knx_daemon._format_duration(311) == "5m 11s"
    assert knx_daemon._format_duration(7500) == "2h 5m"


def test_build_secure_config_warns_when_keyring_has_no_password(tmp_path, caplog):
    import knx_daemon

    keys = tmp_path / "keys.knxkeys"
    keys.write_text("<Keyring/>")
    with patch.object(knx_daemon, "_resolve_knxkeys_path", return_value=(str(keys), None)):
        with caplog.at_level("WARNING"):
            config = knx_daemon._build_secure_config()

    assert config is not None
    assert "no password was found" in caplog.text


def test_build_secure_config_warns_when_keyring_file_missing(tmp_path, caplog):
    import knx_daemon

    missing = str(tmp_path / "missing.knxkeys")
    with patch.object(knx_daemon, "_resolve_knxkeys_path", return_value=(missing, "pw")):
        with caplog.at_level("WARNING"):
            knx_daemon._build_secure_config()

    assert "does not exist" in caplog.text


def test_build_secure_config_warns_for_manual_tunnel_credentials(caplog, monkeypatch):
    import knx_daemon

    monkeypatch.setenv("KNX_SECURE_USER_ID", "2")
    monkeypatch.setenv("KNX_SECURE_USER_PASSWORD", "x")
    with patch.object(knx_daemon, "_resolve_knxkeys_path", return_value=(None, None)):
        with caplog.at_level("WARNING"):
            knx_daemon._build_secure_config()

    assert "Data Secure" in caplog.text


@pytest.mark.asyncio
async def test_upload_knxkeys_without_password_removes_stale_password_file(tmp_path, monkeypatch):
    import io

    from fastapi import UploadFile

    import api
    import knx_daemon

    monkeypatch.delenv("KNX_KNXKEYS_FILE", raising=False)
    keys = tmp_path / "knx_keys.knxkeys"
    pw = tmp_path / "knx_keys_password"
    pw.write_text("old")
    monkeypatch.setattr(knx_daemon, "DEFAULT_KNXKEYS_FILE", str(keys))
    monkeypatch.setattr(knx_daemon, "DEFAULT_KNXKEYS_PASSWORD_FILE", str(pw))

    upload = UploadFile(filename="new.knxkeys", file=io.BytesIO(b"<Keyring/>"))
    with patch.object(knx_daemon, "_reconnect_knx", new=AsyncMock()):
        await api.upload_knxkeys(file=upload, password="")

    assert keys.exists()
    assert not pw.exists()
