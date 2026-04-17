import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone
from knx_daemon import process_telegram_async, telegram_received_cb
from xknx.telegram import Telegram as XknxTelegram
from xknx.telegram.address import IndividualAddress, GroupAddress
from xknx.dpt import DPTBinary

@pytest.mark.asyncio
@patch("knx_daemon.AsyncSessionLocal")
@patch("knx_daemon.manager.broadcast", new_callable=AsyncMock)
@patch("knx_daemon.parse_telegram_payload")
async def test_process_telegram_async(mock_parse, mock_broadcast, mock_session_local):
    # Setup mocks
    mock_session = AsyncMock()
    mock_session_local.return_value.__aenter__.return_value = mock_session
    
    # Mock parse_telegram_payload return value
    # value_numeric, value_json, raw_data, dpt_str, dpt_main, dpt_sub, unit, value_formatted, raw_hex
    mock_parse.return_value = (
        1.0, 
        True, 
        b"\x01", 
        "1.001", 
        1, 
        1, 
        "on/off", 
        "On", 
        "01"
    )
    
    # Create a dummy xknx telegram
    telegram = XknxTelegram(
        source_address=IndividualAddress("1.1.1"),
        destination_address=GroupAddress("1/1/1"),
        payload=DPTBinary(1)
    )
    
    # Run the function
    await process_telegram_async(telegram)
    
    # Verify DB insertion
    assert mock_session.execute.called
    assert mock_session.commit.called
    
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
