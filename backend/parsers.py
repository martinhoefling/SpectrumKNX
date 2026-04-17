from xknx.dpt import DPTBase
from xknx.dpt.dpt_10 import KNXTime
from xknx.dpt.dpt_11 import KNXDate
from xknx.dpt.dpt_19 import KNXDateTime


def format_dpt_name(main, sub):
    """Resolves DPT main and sub numbers into a descriptive name like '5.001 - Percent'."""
    if main is None:
        return None, None
        
    try:
        num_str = f"{main}.{sub:03d}" if sub is not None else str(main)
        tc = DPTBase.parse_transcoder(num_str)
        if tc:
            v_type = getattr(tc, 'value_type', None)
            unit = getattr(tc, 'unit', None)
            name = f"{num_str} - {str(v_type).title()}" if v_type else num_str
            return name, unit
    except Exception:
        pass
        
    return (f"{main}.{sub:03d}" if sub is not None else str(main)), None

def get_simplified_type(tech_type: str) -> str:
    """Maps technical GroupValue names to simple Read/Write/Response."""
    mapping = {
        "GroupValueWrite": "Write",
        "GroupValueRead": "Read",
        "GroupValueResponse": "Response"
    }
    return mapping.get(tech_type, tech_type)

def format_value_nicely(value, dpt_main=None, dpt_sub=None):
    """Formats numeric or boolean values into clean, HA-style strings."""
    if isinstance(value, bool) or (dpt_main == 1):
        try:
             num_str = f"{dpt_main}.{dpt_sub:03d}" if dpt_sub is not None else "1.001"
             tc = DPTBase.parse_transcoder(num_str)
             if tc and hasattr(tc, 'value_to_str'):
                  # Note: xknx's to_str often returns the descriptive name
                  return str(tc.to_knx(value).to_str() if hasattr(tc, 'to_knx') else value).lower()
        except Exception:
             pass
        return "on" if value else "off"
    
    if isinstance(value, int | float):
        # Truncate zeroes: 21.60 -> 21.6, 100.00 -> 100
        return f"{value:g}"
        
    return str(value)

def convert_value_for_db(value):
    """Converts KNX decoded values into standard types for the database."""
    if isinstance(value, int | float | bool | str | dict | list):
        return value
    elif isinstance(value, KNXTime):
        return value.as_time().strftime('%H:%M:%S')
    elif isinstance(value, KNXDate):
        return value.as_date().isoformat()
    elif isinstance(value, KNXDateTime):
        return value.as_datetime().strftime('%Y-%m-%d %H:%M:%S')
    elif hasattr(value, "value"):
        return value.value
    # Fallback to string representation for safe json serialization
    return str(value)

def parse_telegram_dpt(telegram, xknx=None):
    """Extracts the mathematical DPT components from KNX telegram/xknx context."""
    dpt_class = None
    
    # 1. Check if xknx has a DPT assigned for this destination
    if xknx:
        dpt_class = xknx.group_address_dpt.get(telegram.destination_address)
    
    # 2. If no xknx context, check decoded_data for a transcoder (fallback)
    if not dpt_class and hasattr(telegram, 'decoded_data') and hasattr(telegram.decoded_data, 'transcoder'):
        dpt_class = telegram.decoded_data.transcoder

    if dpt_class:
        main_num = getattr(dpt_class, 'dpt_main_number', None)
        sub_num = getattr(dpt_class, 'dpt_sub_number', None)
        
        if main_num is not None:
            num_str = f"{main_num}.{sub_num:03d}" if sub_num is not None else f"{main_num}"
            return num_str, main_num, sub_num
        return dpt_class.__name__, None, None

    return None, None, None

def parse_telegram_payload(telegram, xknx=None):
    """Extracts numeric value, json value, raw bytes, and dpt components from a telegram."""
    value_numeric = None
    value_json = None
    raw_data = None
    dpt_str, dpt_main, dpt_sub = parse_telegram_dpt(telegram, xknx)
    _, unit = format_dpt_name(dpt_main, dpt_sub)
    
    # 1. Extract Raw Bytes if possible
    payload_val = getattr(telegram.payload, 'value', None)
    if payload_val is not None:
        try:
             v = getattr(payload_val, 'value', payload_val)
             if isinstance(v, tuple | list):
                  raw_data = bytes(v)
             elif isinstance(v, int):
                  raw_data = bytes([v])
        except Exception:
             pass

    # 2. Extract Decoded Value if DPT was matched 
    value_formatted = None
    if telegram.decoded_data is not None:
        val = convert_value_for_db(telegram.decoded_data.value)
        value_formatted = format_value_nicely(val, dpt_main, dpt_sub)
        
        if isinstance(val, int | float) and not isinstance(val, bool):
            value_numeric = float(val)
        elif isinstance(val, bool):
            value_numeric = 1.0 if val else 0.0
        else:
            value_json = {"value": val}

    # 3. Use raw string if decoding failed but payload exists
    if value_numeric is None and value_json is None and payload_val is not None:
        v = getattr(payload_val, 'value', payload_val)
        if isinstance(v, int | float) and not isinstance(v, bool):
            value_numeric = float(v)
        elif isinstance(v, bool):
            value_numeric = 1.0 if v else 0.0
        elif isinstance(v, tuple | list):
            value_json = {"value": list(v)}
        else:
            value_json = {"value": str(v)}
            
    raw_hex = raw_data.hex() if raw_data else None
    if raw_hex and len(raw_hex) > 1:
        raw_hex = f"0x{raw_hex}"
            
    return value_numeric, value_json, raw_data, dpt_str, dpt_main, dpt_sub, unit, value_formatted, raw_hex
