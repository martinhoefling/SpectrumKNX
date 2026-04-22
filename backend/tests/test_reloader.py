# Mocking the xknxproject before importing knx_daemon to avoid import errors if not installed in environment
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.modules['xknxproject'] = MagicMock()

from knx_daemon import _load_project_data, _watch_files  # noqa: E402


@pytest.mark.asyncio
@patch("knx_daemon.os.path.exists")
@patch("knx_daemon.os.getenv")
@patch("xknxproject.XKNXProj")
async def test_load_project_data(mock_xknxproj_class, mock_getenv, mock_exists):
    # Setup mocks
    mock_getenv.side_effect = lambda k: "fake_path.knxproj" if k == "KNX_PROJECT_PATH" else "fake_pass"
    mock_exists.return_value = True
    
    mock_xknxproj = MagicMock()
    mock_xknxproj_class.return_value = mock_xknxproj
    
    # Mock project data
    mock_xknxproj.parse.return_value = {
        "group_addresses": {
            "1/1/1": {"name": "Test GA", "dpt": "1.001"}
        },
        "devices": {
            "1.1.1": {"name": "Test Device"}
        }
    }
    
    # Mock xknx_instance
    with patch("knx_daemon.xknx_instance") as mock_xknx:
        # Mocking the XKNX instance structure
        mock_xknx.group_address_dpt = MagicMock()
        
        # Run
        await _load_project_data()
        
        # Verify global maps are updated
        from knx_daemon import project_name_map
        assert project_name_map["ga"]["1/1/1"] == "Test GA"
        assert project_name_map["ia"]["1.1.1"] == "Test Device"
        
        # Verify XKNX DPTs are updated
        assert mock_xknx.group_address_dpt.set.called
        dpt_dict = mock_xknx.group_address_dpt.set.call_args[0][0]
        assert dpt_dict["1/1/1"] == "1.001"

@pytest.mark.asyncio
@patch("knx_daemon.os.path.exists")
@patch("knx_daemon.os.path.getmtime")
@patch("knx_daemon._load_project_data", new_callable=AsyncMock)
@patch("knx_daemon.asyncio.sleep", new_callable=AsyncMock)
@patch("knx_daemon._resolve_knxkeys_path", return_value=(None, None))
async def test_watch_files(mock_resolve, mock_sleep, mock_load, mock_getmtime, mock_exists):
    # Setup
    mock_exists.return_value = True
    # First call to getmtime is in init (project), second is init (keys doesn't exist),
    # third is loop check (project changed), fourth would be keys check
    mock_getmtime.side_effect = [100, 0, 200, 0] 
    
    # Break infinite loop by raising an exception in the second sleep call
    mock_sleep.side_effect = [None, Exception("StopLoop")]
    
    with patch("knx_daemon.os.getenv") as mock_getenv:
        mock_getenv.return_value = "fake_path.knxproj"
        
        try:
            await _watch_files()
        except Exception as e:
            if str(e) != "StopLoop":
                raise e
        
        # Verify _load_project_data was called due to mtime change (100 -> 200)
        assert mock_load.called
        assert mock_load.call_count == 1
