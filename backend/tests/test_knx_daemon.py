from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from xknx.dpt import DPTBinary
from xknx.telegram import Telegram as XknxTelegram
from xknx.telegram.address import GroupAddress, IndividualAddress

from knx_daemon import process_telegram_async, telegram_received_cb


@pytest.mark.asyncio
@patch("knx_daemon.store.store", new_callable=AsyncMock)
@patch("knx_daemon.manager.broadcast", new_callable=AsyncMock)
@patch("knx_daemon.parse_telegram_payload")
async def test_process_telegram_async(mock_parse, mock_broadcast, mock_store):
    # Setup mocks

    # Mock parse_telegram_payload return value
    # value_numeric, value_json, raw_data, dpt_str, dpt_main, dpt_sub, unit, value_formatted, raw_hex
    mock_parse.return_value = (1.0, True, b"\x01", "1.001", 1, 1, "on/off", "On", "01")

    # Create a dummy xknx telegram
    telegram = XknxTelegram(
        source_address=IndividualAddress("1.1.1"), destination_address=GroupAddress("1/1/1"), payload=DPTBinary(1)
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
@patch("knx_daemon._watch_files")
async def test_knx_startup_success(
    mock_watch_files, mock_xknx, mock_load_project, mock_store_start, mock_store_init, mock_check_conn
):
    from knx_telegram_store.connection import ConnectionCheckResult
    mock_check_conn.return_value = ConnectionCheckResult.success()
    mock_xknx_instance = MagicMock()
    mock_xknx.return_value = mock_xknx_instance
    mock_xknx_instance.start = AsyncMock()

    from knx_daemon import knx_startup
    with patch("knx_daemon.global_knx_project", None):
        await knx_startup()

    mock_check_conn.assert_called_once()
    mock_store_init.assert_called_once()
    mock_store_start.assert_called_once()
    mock_xknx_instance.start.assert_called_once()


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
