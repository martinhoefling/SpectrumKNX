import enum

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
            v_type = getattr(tc, "value_type", None)
            unit = getattr(tc, "unit", None)
            name = f"{num_str} - {str(v_type).title()}" if v_type else num_str
            return name, unit
    except Exception:
        pass

    return (f"{main}.{sub:03d}" if sub is not None else str(main)), None


def get_simplified_type(tech_type: str) -> str:
    """Maps technical GroupValue names to simple Read/Write/Response."""
    mapping = {"GroupValueWrite": "Write", "GroupValueRead": "Read", "GroupValueResponse": "Response"}
    return mapping.get(tech_type, tech_type)


# Generic boolean words. A subtype's own name always wins over these, so
# "up" stays "up", while a bare "on" on DPT 1.008 becomes "down".
_FALSE_WORDS = {"0", "false", "off", "no"}
_TRUE_WORDS = {"1", "true", "on", "yes"}
_transcoder_cache: dict[tuple[int, int], type | None] = {}


def _pretty_enum(name: str) -> str:
    return name.replace("_", " ").lower()


def _small_transcoder(main: int, sub: int):
    key = (main, sub)
    if key not in _transcoder_cache:
        try:
            _transcoder_cache[key] = DPTBase.parse_transcoder(f"{main}.{sub:03d}")
        except Exception:
            _transcoder_cache[key] = None
    return _transcoder_cache[key]


def _value_enum(main: int, sub: int | None):
    """Enum of the named values of a ≤4-bit DPT, or None when it has none."""
    if sub is None or main not in (1, 2, 3):
        return None
    tc = _small_transcoder(main, sub)
    dt = getattr(tc, "data_type", None)
    if main == 2:
        value_type = getattr(dt, "_value_type", None)
        if isinstance(value_type, type) and issubclass(value_type, enum.Enum):
            return value_type
        return None
    if main == 3:
        control = getattr(dt, "__annotations__", {}).get("control")
        if isinstance(control, type) and issubclass(control, enum.Enum):
            return control
        return None
    if isinstance(dt, type) and issubclass(dt, enum.Enum):
        return dt
    return None


def _name_for_bit(enum_cls, bit: bool) -> str:
    for member in enum_cls:
        if bool(member.value) is bit:
            return _pretty_enum(member.name)
    return "on" if bit else "off"


def _enum_label(enum_cls, value) -> str | None:
    """Subtype name for a bit, a 0/1, or a boolean word. None if it isn't one."""
    if enum_cls is None:
        return None
    by_name = {_pretty_enum(member.name): _pretty_enum(member.name) for member in enum_cls}
    raw_names = {member.name.lower(): _pretty_enum(member.name) for member in enum_cls}
    if isinstance(value, str):
        raw = value.strip().lower()
        pretty = raw.replace("_", " ")
        if raw in raw_names:
            return raw_names[raw]
        if pretty in by_name:
            return by_name[pretty]
        if raw in _FALSE_WORDS:
            return _name_for_bit(enum_cls, False)
        if raw in _TRUE_WORDS:
            return _name_for_bit(enum_cls, True)
        return None
    if isinstance(value, bool):
        return _name_for_bit(enum_cls, value)
    if isinstance(value, int | float) and value in (0, 1):
        return _name_for_bit(enum_cls, bool(value))
    return None


def format_value_nicely(value, dpt_main=None, dpt_sub=None):
    """Formats numeric or boolean values into clean, HA-style strings."""
    if value is None:
        # Payload-less telegrams (GroupValueRead) and undecoded payloads carry
        # no value — never fabricate one (#181).
        return None

    if isinstance(value, bool) or (dpt_main == 1):
        # DPT-1 values arrive as bools, 0/1 numerics, or already-decoded enum
        # names ("off", "down", ...) from Home Assistant. Strings ARE the
        # display value — truth-testing them would render "off" as "on" (#181).
        # A known subtype uses its own names (1.002 true/false, 1.008 up/down).
        if isinstance(value, str):
            label = _enum_label(_value_enum(dpt_main or 1, dpt_sub), value)
            return label if label is not None else value.lower()
        label = _enum_label(_value_enum(dpt_main or 1, dpt_sub), value)
        if label is not None:
            return label
        return "on" if value else "off"

    if dpt_main == 2 and isinstance(value, dict) and "value" in value:
        # {"control": True, "value": "on"} -> "on (control)", or the subtype's
        # own word ("true (control)" for 2.002).
        shown = _enum_label(_value_enum(2, dpt_sub), value["value"])
        if shown is None:
            shown = str(value["value"])
        return f"{shown} (control)" if value.get("control") else shown

    if dpt_main == 3 and isinstance(value, dict) and "control" in value:
        # 4-bit control: direction name plus the step code (0–7).
        shown = _enum_label(_value_enum(3, dpt_sub), value["control"])
        if shown is None:
            shown = str(value["control"])
        step = value.get("step_code")
        return f"{shown} {step}" if step is not None else shown

    if isinstance(value, int | float):
        # Truncate zeroes: 21.60 -> 21.6, 100.00 -> 100
        return f"{value:g}"

    if isinstance(value, dict):
        # Composite DPTs: {"red": 1, "green": 2, "blue": 3} -> "red 1, green 2, blue 3"
        return _format_fields(value)

    return str(value)


def _format_fields(fields: dict) -> str:
    parts = []
    for key, val in fields.items():
        if val is None:
            continue
        if isinstance(val, dict):
            val = f"({_format_fields(val)})"
        elif isinstance(val, bool):
            val = str(val).lower()
        elif isinstance(val, float):
            val = f"{val:g}"
        parts.append(f"{key} {val}")
    return ", ".join(parts)


def convert_value_for_db(value):
    """Converts KNX decoded values into standard types for the database."""
    if isinstance(value, int | float | bool | str | dict | list):
        return value
    elif isinstance(value, KNXTime):
        return value.as_time().strftime("%H:%M:%S")
    elif isinstance(value, KNXDate):
        return value.as_date().isoformat()
    elif isinstance(value, KNXDateTime):
        return value.as_datetime().strftime("%Y-%m-%d %H:%M:%S")
    elif hasattr(value, "as_dict"):
        # Composite DPTs decode to dataclasses, e.g. SwitchControl (2.x, #534),
        # ControlDimming (3.007) or RGBColor (232.600). as_dict() is JSON-safe;
        # str() would store the Python repr (#547)
        return value.as_dict()
    elif hasattr(value, "value"):
        # Enums (1.001 decodes to Switch.ON) and wrappers; their value may wrap again
        return convert_value_for_db(value.value)
    # Fallback to string representation for safe json serialization
    return str(value)


def parse_telegram_dpt(telegram, xknx=None):
    """Extracts the mathematical DPT components from KNX telegram/xknx context."""
    dpt_class = None

    # 1. Check if xknx has a DPT assigned for this destination
    if xknx:
        dpt_class = xknx.group_address_dpt.get(telegram.destination_address)

    # 2. If no xknx context, check decoded_data for a transcoder (fallback)
    if not dpt_class and hasattr(telegram, "decoded_data") and hasattr(telegram.decoded_data, "transcoder"):
        dpt_class = telegram.decoded_data.transcoder

    if dpt_class:
        main_num = getattr(dpt_class, "dpt_main_number", None)
        sub_num = getattr(dpt_class, "dpt_sub_number", None)

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
    payload_val = getattr(telegram.payload, "value", None)
    if payload_val is not None:
        try:
            v = getattr(payload_val, "value", payload_val)
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
            value_json = val

    # 3. Use raw string if decoding failed but payload exists
    if value_numeric is None and value_json is None and payload_val is not None:
        v = getattr(payload_val, "value", payload_val)
        if isinstance(v, int | float) and not isinstance(v, bool):
            value_numeric = float(v)
        elif isinstance(v, bool):
            value_numeric = 1.0 if v else 0.0
        elif isinstance(v, tuple | list):
            value_json = list(v)
        else:
            value_json = str(v)

    raw_hex = raw_data.hex() if raw_data else None
    if raw_hex and len(raw_hex) > 1:
        raw_hex = f"0x{raw_hex}"

    return value_numeric, value_json, raw_data, dpt_str, dpt_main, dpt_sub, unit, value_formatted, raw_hex
