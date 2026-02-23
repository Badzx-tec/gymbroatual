import struct
from dataclasses import dataclass

PKT_PREFIX = 0x53
PKT_SUFFIX = 0xC3
PKT_LEN = 20

# Backward-compatible names used by tests/docs.
PREFIX = PKT_PREFIX
SUFFIX = PKT_SUFFIX
PACKET_SIZE = PKT_LEN

# Function commands (host -> LiteNet2)
CMD_RELEASE_ENTRY = 0x0001
CMD_RELEASE_EXIT = 0x0002
CMD_NOTIFY_USER = 0x0005
CMD_RELEASE_BOTH = 0x0006
CMD_QUERY_FW = 0x010C
CMD_QUERY_INIT_STATES = 0x0112

# Notification commands (LiteNet2 -> host)
EVT_RFID = 0x0301
EVT_BARCODE = 0x0302
EVT_KEYPAD = 0x0303
EVT_PASSAGE = 0x0304
EVT_TIMEOUT = 0x0305
EVT_BIOMETRY = 0x0306
EVT_BIOMETRY_UNKNOWN = 0x0307


@dataclass
class LiteNet2Packet:
    command: int
    data: bytes


def payload_msg16(message: str) -> bytes:
    return (message or "").encode("ascii", errors="ignore")[:16].ljust(16, b"\x00")


def ascii16(data: bytes) -> str:
    return bytes(data[:16]).decode("ascii", errors="ignore").rstrip("\x00").strip()


def u16le(data: bytes) -> int:
    return int.from_bytes(bytes(data[:2]), "little")


def u32le(data: bytes) -> int:
    return int.from_bytes(bytes(data[:4]), "little")


def build_packet(command: int, data: bytes = b"") -> bytes:
    payload = (data or b"")[:16].ljust(16, b"\x00")
    return struct.pack("<B H 16s B", PKT_PREFIX, command, payload, PKT_SUFFIX)


def encode_packet(command: int, data: bytes = b"") -> bytes:
    return build_packet(command=command, data=data)


def parse_packet(packet: bytes) -> LiteNet2Packet:
    if len(packet) != PKT_LEN:
        raise ValueError(f"invalid packet size {len(packet)} != {PKT_LEN}")
    prefix, command, payload, suffix = struct.unpack("<B H 16s B", packet)
    if prefix != PKT_PREFIX or suffix != PKT_SUFFIX:
        raise ValueError(
            f"invalid packet envelope {prefix:02x}...{suffix:02x}"
        )
    return LiteNet2Packet(command=command, data=payload)


def decode_packet(packet: bytes) -> LiteNet2Packet:
    return parse_packet(packet)


def encode_release_entry(message: str = "LIBERADO") -> bytes:
    return build_packet(CMD_RELEASE_ENTRY, payload_msg16(message))


def encode_release_exit(message: str = "SAIDA") -> bytes:
    return build_packet(CMD_RELEASE_EXIT, payload_msg16(message))


def encode_release_both(message: str = "LIBERADO") -> bytes:
    return build_packet(CMD_RELEASE_BOTH, payload_msg16(message))


def encode_notify_user(code: int = 1, duration: int = 2, led: int = 1) -> bytes:
    payload = bytes([code & 0xFF, duration & 0xFF, led & 0xFF])
    return build_packet(CMD_NOTIFY_USER, payload)


def encode_query_fw() -> bytes:
    return build_packet(CMD_QUERY_FW)


def encode_query_init_states() -> bytes:
    return build_packet(CMD_QUERY_INIT_STATES)


def parse_notification(command: int, data: bytes) -> dict | None:
    if command == EVT_RFID:
        return {"kind": "credential", "method": "rfid", "credential": ascii16(data)}
    if command == EVT_KEYPAD:
        return {"kind": "credential", "method": "keypad", "credential": ascii16(data)}
    if command == EVT_BIOMETRY:
        return {"kind": "credential", "method": "biometry", "credential": str(u16le(data))}
    if command == EVT_BARCODE:
        return {"kind": "credential", "method": "barcode", "credential": ascii16(data)}
    if command == EVT_PASSAGE:
        direction_raw = data[0]
        direction = "entry" if direction_raw == 1 else "exit" if direction_raw == 2 else "unknown"
        return {
            "kind": "operational",
            "type": "passage",
            "direction": direction,
            "count": u32le(data[1:5]),
        }
    if command == EVT_TIMEOUT:
        return {"kind": "operational", "type": "release_timeout"}
    if command == EVT_BIOMETRY_UNKNOWN:
        return {"kind": "operational", "type": "biometry_unknown"}
    return None


def parse_event(packet: bytes) -> dict:
    decoded = parse_packet(packet)
    notification = parse_notification(decoded.command, decoded.data)
    if not notification:
        return {
            "command": decoded.command,
            "method": "unknown",
            "credential": "",
            "raw": decoded.data.hex(),
        }

    if notification["kind"] == "credential":
        return {
            "command": decoded.command,
            "method": notification["method"],
            "credential": notification["credential"],
            "raw": decoded.data.hex(),
        }

    if notification["type"] == "passage":
        return {
            "command": decoded.command,
            "method": "passage",
            "credential": str(notification["count"]),
            "raw": decoded.data.hex(),
            "direction": notification["direction"],
        }

    return {
        "command": decoded.command,
        "method": "unknown",
        "credential": "",
        "raw": decoded.data.hex(),
        "type": notification["type"],
    }
