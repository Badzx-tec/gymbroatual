import importlib.util
from pathlib import Path


def _load_protocol_module():
    path = Path(__file__).resolve().parents[2] / "gateway-toletus" / "protocol.py"
    spec = importlib.util.spec_from_file_location("gateway_protocol", path)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None and spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_litenet2_encode_decode_release_entry():
    protocol = _load_protocol_module()
    packet = protocol.encode_release_entry("OK")
    assert len(packet) == 20

    decoded = protocol.decode_packet(packet)
    assert decoded.command == protocol.CMD_RELEASE_ENTRY
    assert decoded.data.startswith(b"OK")


def test_litenet2_parse_event_rfid():
    protocol = _load_protocol_module()
    packet = protocol.encode_packet(protocol.EVT_RFID, b"000123")
    event = protocol.parse_event(packet)

    assert event["method"] == "rfid"
    assert event["credential"] == "000123"
