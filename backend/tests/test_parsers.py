from unittest.mock import patch

from parsers import (
    convert_value_for_db,
    format_dpt_name,
    get_simplified_type,
    parse_telegram_dpt,
    parse_telegram_payload,
)


def test_get_simplified_type():
    assert get_simplified_type("GroupValueWrite") == "Write"
    assert get_simplified_type("GroupValueRead") == "Read"
    assert get_simplified_type("GroupValueResponse") == "Response"
    assert get_simplified_type("UnknownType") == "UnknownType"
    assert get_simplified_type("") == ""

def test_convert_value_for_db_basic_types():
    assert convert_value_for_db(22.5) == 22.5
    assert convert_value_for_db(1) == 1
    assert convert_value_for_db(True) is True
    assert convert_value_for_db("hello") == "hello"
    assert convert_value_for_db({"key": "val"}) == {"key": "val"}

def test_convert_value_for_db_complex_types():
    class GenericValue:
        def __init__(self, val):
            self.value = val
            
    assert convert_value_for_db(GenericValue("custom")) == "custom"
    
    class GenericObj:
        def __str__(self):
            return "string_fallback"
            
    assert convert_value_for_db(GenericObj()) == "string_fallback"

def test_parse_telegram_dpt_with_transcoder_mock():
    class MockTranscoder:
        dpt_main_number = 9
        dpt_sub_number = 1
        value_type = "temperature"
        __name__ = "DPTTemperature"
        
    class MockDecoded:
        transcoder = MockTranscoder()
        
    class MockTelegram:
        decoded_data = MockDecoded()
        destination_address = "1/1/1"
        
    dpt_str, dpt_main, dpt_sub = parse_telegram_dpt(MockTelegram())
    assert dpt_str == "9.001"
    assert dpt_main == 9
    assert dpt_sub == 1

def test_parse_telegram_dpt_without_sub():
    class MockTranscoderNoSub:
        dpt_main_number = 4
        dpt_sub_number = None
        value_type = "character"
        __name__ = "DPTChar"
        
    class MockDecodedNoSub:
        transcoder = MockTranscoderNoSub()
        
    class MockTelegram:
        decoded_data = MockDecodedNoSub()
        destination_address = "2/2/2"
        
    dpt_str, dpt_main, dpt_sub = parse_telegram_dpt(MockTelegram())
    assert dpt_str == "4"
    assert dpt_main == 4
    assert dpt_sub is None

def test_parse_telegram_dpt_fallback():
    class MockTelegram:
        decoded_data = None
        destination_address = "1/1/1"
        
    dpt_str, dpt_main, dpt_sub = parse_telegram_dpt(MockTelegram())
    assert dpt_str is None
    assert dpt_main is None
    assert dpt_sub is None

def test_parse_telegram_payload():
    # Construct a mock telegram
    class MockPayload:
        value = 22.5
        
    class MockTelegram:
        payload = MockPayload()
        decoded_data = None
        destination_address = "3/3/3"
        
    value_numeric, value_json, raw_data, dpt_str, dpt_main, dpt_sub, unit, value_formatted, raw_hex = parse_telegram_payload(MockTelegram())
    
    assert value_numeric == 22.5
    assert value_json is None
    assert dpt_str is None
    assert dpt_main is None
    assert dpt_sub is None

def test_parse_telegram_dpt_via_xknx():
    class MockDPT:
        dpt_main_number = 5
        dpt_sub_number = 1
        value_type = "scaling"

    class MockXknx:
        group_address_dpt = {"1/6/2": MockDPT}

    class MockTelegram:
        destination_address = "1/6/2"
        decoded_data = None

    dpt_str, dpt_main, dpt_sub = parse_telegram_dpt(MockTelegram(), MockXknx())
    assert dpt_str == "5.001"
    assert dpt_main == 5
    assert dpt_sub == 1

def test_parse_telegram_payload_with_dpt_array():
    class MockDPTArray:
        def __init__(self, value):
            self.value = value
        def __str__(self):
            return f"<DPTArray value=\"{self.value}\" />"

    class MockPayload:
        value = MockDPTArray((0xfc,))
        
    class MockTelegram:
        payload = MockPayload()
        decoded_data = None
        destination_address = "0/7/2"
        
    value_numeric, value_json, raw_data, dpt_str, dpt_main, dpt_sub, unit, value_formatted, raw_hex = parse_telegram_payload(MockTelegram())
    
    # 0xfc = 252
    assert raw_data == b'\xfc'
    assert value_json == {"value": [252]}
    assert value_numeric is None
    assert dpt_main is None

def test_parse_telegram_payload_with_dpt_binary():
    class MockDPTBinary:
        def __init__(self, value):
            self.value = value
        def __str__(self):
            return f"<DPTBinary value=\"{self.value}\" />"

    class MockPayload:
        value = MockDPTBinary(1)
        
    class MockTelegram:
        payload = MockPayload()
        decoded_data = None
        destination_address = "0/0/1"
        
    value_numeric, value_json, raw_data, dpt_str, dpt_main, dpt_sub, unit, value_formatted, raw_hex = parse_telegram_payload(MockTelegram())
    
    assert raw_data == b'\x01'
    assert value_numeric == 1.0
    assert value_json is None
    assert dpt_main is None

def test_format_dpt_name():
    # Test common DPTs (assuming xknx is present in the environment where tests run)
    # 1.001 -> "1.001 - Switch"
    # 5.001 -> "5.001 - Percent"
    # 9.001 -> "9.001 - Temperature"
    
    # format_dpt_name returns (name, unit) tuple
    name, unit = format_dpt_name(1, 1)
    assert "1.001" in name
    name, unit = format_dpt_name(5, 1)
    assert "5.001" in name
    name, unit = format_dpt_name(9, 1)
    assert "9.001" in name
    
    assert format_dpt_name(None, None) == (None, None)

def test_format_dpt_name_invalid_inputs():
    # When DPTBase.parse_transcoder fails to find a valid match, it may just return None.
    # To truly hit the 'except Exception' fallback block requested, we force an exception.
    # Alternatively we can try invalid combinations if they throw. xknx usually returns None
    # instead of throwing on unknown string format (e.g., '9999').
    # So we use mock to ensure the 'except Exception' block runs.
    with patch('parsers.DPTBase.parse_transcoder', side_effect=Exception("Test Error")):
        # Test with main and sub
        name, unit = format_dpt_name(999, 999)
        assert name == "999.999"
        assert unit is None

        # Test with main only
        name, unit = format_dpt_name(999, None)
        assert name == "999"
        assert unit is None
