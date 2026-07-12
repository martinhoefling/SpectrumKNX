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
    ("allow_write", "read_only", "connected", "expected"),
    [
        (True, False, True, True),
        (False, False, True, False),
        (True, True, True, False),
        (True, False, False, False),
    ],
)
def test_write_enabled(allow_write, read_only, connected, expected):
    import knx_daemon

    with (
        patch.object(knx_daemon, "ALLOW_WRITE", allow_write),
        patch.object(knx_daemon, "READ_ONLY", read_only),
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
