import struct
from dataclasses import dataclass

PREFIX = 0x53
SUFFIX = 0xC3
PACKET_SIZE = 20

CMD_RELEASE_ENTRY = 0x0001
CMD_RELEASE_EXIT = 0x0002
CMD_NOTIFY_USER = 0x0005
CMD_RELEASE_BOTH = 0x0006

EVT_RFID = 0x0301
EVT_PASSAGE = 0x0304
EVT_KEYPAD = 0x0303
EVT_BIOMETRY = 0x0306


@dataclass
class LiteNet2Packet:
    command: int
    data: bytes


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


def encode_release_entry(message: str = "LIBERADO") -> bytes:
    return encode_packet(
        CMD_RELEASE_ENTRY, message.encode("ascii", errors="ignore")[:16]
    )


def encode_release_exit(message: str = "SAIDA") -> bytes:
    return encode_packet(
        CMD_RELEASE_EXIT, message.encode("ascii", errors="ignore")[:16]
    )


def encode_notify_user(code: int = 1, duration: int = 2, led: int = 1) -> bytes:
    payload = bytes([code & 0xFF, duration & 0xFF, led & 0xFF])
    return encode_packet(CMD_NOTIFY_USER, payload)


def parse_event(packet: bytes) -> dict:
    decoded = decode_packet(packet)
    raw = decoded.data.rstrip(b"\x00")
    value = raw.decode("ascii", errors="ignore")
    method = "unknown"
    if decoded.command == EVT_RFID:
        method = "rfid"
    elif decoded.command == EVT_KEYPAD:
        method = "keypad"
    elif decoded.command == EVT_BIOMETRY:
        method = "biometry"
    elif decoded.command == EVT_PASSAGE:
        method = "passage"
    return {
        "command": decoded.command,
        "method": method,
        "credential": value,
        "raw": raw.hex(),
    }
