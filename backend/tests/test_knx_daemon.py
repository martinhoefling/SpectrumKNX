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
