import struct
from dataclasses import dataclass

PREFIX = 0x53
SUFFIX = 0xC3
PACKET_SIZE = 20

CMD_RELEASE_ENTRY = 0x0001
CMD_RELEASE_EXIT = 0x0002
CMD_NOTIFY_USER = 0x0005
CMD_RELEASE_BOTH = 0x0006
CMD_QUERY_FW = 0x010C
CMD_QUERY_INIT_STATES = 0x0112

EVT_RFID = 0x0301
EVT_BARCODE = 0x0302
EVT_KEYPAD = 0x0303
EVT_PASSAGE = 0x0304
EVT_TIMEOUT = 0x0305
EVT_BIOMETRY = 0x0306
EVT_BIOMETRY_UNKNOWN = 0x0307

DIRECTION_ENTRY = "entry"
DIRECTION_EXIT = "exit"
DIRECTION_BOTH = "both"
DIRECTION_UNKNOWN = "unknown"

OPER_CREDENTIAL = "credential"
OPER_OPERATIONAL = "operational"
OPER_UNKNOWN = "unknown"


@dataclass
class LiteNet2Packet:
    command: int
    data: bytes


def _ascii16(data: bytes) -> str:
    return data.decode("ascii", errors="ignore").rstrip("\x00").strip()


def _u16le(data: bytes) -> int:
    return int.from_bytes(data[:2], "little")


def _u32le(data: bytes) -> int:
    return int.from_bytes(data[:4], "little")


def normalize_direction(value) -> str:
    if value is None:
        return DIRECTION_UNKNOWN
    if isinstance(value, int):
        if value == 1:
            return DIRECTION_ENTRY
        if value == 2:
            return DIRECTION_EXIT
        if value == 3:
            return DIRECTION_BOTH
        return DIRECTION_UNKNOWN
    raw = str(value).strip().lower()
    if raw in {"entry", "entrada", "in", "inside", "1"}:
        return DIRECTION_ENTRY
    if raw in {"exit", "saida", "out", "outside", "2"}:
        return DIRECTION_EXIT
    if raw in {"both", "bidir", "bidirectional", "bidirecional", "3"}:
        return DIRECTION_BOTH
    return DIRECTION_UNKNOWN


def encode_packet(command: int, data: bytes = b"") -> bytes:
    payload = (data or b"")[:16].ljust(16, b"\x00")
    return struct.pack("<B H 16s B", PREFIX, command, payload, SUFFIX)


def decode_packet(packet: bytes) -> LiteNet2Packet:
    if len(packet) != PACKET_SIZE:
        raise ValueError("invalid packet size")
    prefix, command, payload, suffix = struct.unpack("<B H 16s B", packet)
    if prefix != PREFIX or suffix != SUFFIX:
        raise ValueError("invalid packet envelope")
    return LiteNet2Packet(command=command, data=payload)


def _message_payload(message: str) -> bytes:
    return (message or "").encode("ascii", errors="ignore")[:16]


def encode_release_entry(message: str = "LIBERADO") -> bytes:
    return encode_packet(CMD_RELEASE_ENTRY, _message_payload(message))


def encode_release_exit(message: str = "LIBERADO") -> bytes:
    return encode_packet(CMD_RELEASE_EXIT, _message_payload(message))


def encode_release_both(message: str = "LIBERADO") -> bytes:
    return encode_packet(CMD_RELEASE_BOTH, _message_payload(message))


def encode_release_for_direction(direction: str, message: str = "LIBERADO") -> bytes:
    normalized = normalize_direction(direction)
    if normalized == DIRECTION_ENTRY:
        return encode_release_entry(message)
    if normalized == DIRECTION_EXIT:
        return encode_release_exit(message)
    return encode_release_both(message)


def encode_notify_user(
    code: int = 1,
    duration: int = 2,
    led: int = 1,
    *,
    duration_ms: int | None = None,
    beep: int | None = None,
    color: int | None = None,
    show_text: int = 1,
) -> bytes:
    # Compat: previous API used (code, duration, led). Manual format is:
    # duration_ms (u16 LE), beep (u8), color (u8), show_text (u8).
    effective_duration_ms = int(duration_ms) if duration_ms is not None else int(duration) * 1000
    effective_beep = int(beep) if beep is not None else int(code)
    effective_color = int(color) if color is not None else int(led)

    payload = bytearray(16)
    payload[0:2] = int(max(0, effective_duration_ms)).to_bytes(2, "little", signed=False)
    payload[2] = effective_beep & 0xFF
    payload[3] = effective_color & 0xFF
    payload[4] = int(show_text) & 0xFF
    return encode_packet(CMD_NOTIFY_USER, bytes(payload))


def encode_query_fw() -> bytes:
    return encode_packet(CMD_QUERY_FW)


def encode_query_init_states() -> bytes:
    return encode_packet(CMD_QUERY_INIT_STATES)


def _credential_from_payload(command: int, data: bytes) -> str:
    text = _ascii16(data)
    if command == EVT_BIOMETRY:
        if text and text.isdigit():
            return text
        bio_id = _u16le(data)
        return str(bio_id) if bio_id else text
    return text


def parse_event(packet: bytes) -> dict:
    decoded = decode_packet(packet)
    command = decoded.command
    raw_data = decoded.data

    if command in {EVT_RFID, EVT_BARCODE, EVT_KEYPAD, EVT_BIOMETRY}:
        method = {
            EVT_RFID: "rfid",
            EVT_BARCODE: "barcode",
            EVT_KEYPAD: "keypad",
            EVT_BIOMETRY: "biometry",
        }[command]
        return {
            "kind": OPER_CREDENTIAL,
            "type": "credential",
            "command": command,
            "method": method,
            "credential": _credential_from_payload(command, raw_data),
            "direction": DIRECTION_UNKNOWN,
            "raw": raw_data.hex(),
        }

    if command == EVT_PASSAGE:
        direction_raw = raw_data[0]
        direction = normalize_direction(direction_raw)
        count = _u32le(raw_data[1:5])
        return {
            "kind": OPER_OPERATIONAL,
            "type": "passage",
            "command": command,
            "method": "passage",
            "credential": f"{direction}:{count}",
            "direction": direction,
            "direction_raw": int(direction_raw),
            "count": int(count),
            "raw": raw_data.hex(),
        }

    if command == EVT_TIMEOUT:
        return {
            "kind": OPER_OPERATIONAL,
            "type": "release_timeout",
            "command": command,
            "method": "unknown",
            "credential": "",
            "direction": DIRECTION_UNKNOWN,
            "raw": raw_data.hex(),
        }

    if command == EVT_BIOMETRY_UNKNOWN:
        return {
            "kind": OPER_OPERATIONAL,
            "type": "biometry_unknown",
            "command": command,
            "method": "unknown",
            "credential": "",
            "direction": DIRECTION_UNKNOWN,
            "raw": raw_data.hex(),
        }

    return {
        "kind": OPER_UNKNOWN,
        "type": "unknown",
        "command": command,
        "method": "unknown",
        "credential": "",
        "direction": DIRECTION_UNKNOWN,
        "raw": raw_data.hex(),
    }
