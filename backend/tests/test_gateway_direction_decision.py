import importlib.util
import sys
from pathlib import Path


def _load_gateway_module():
    path = Path(__file__).resolve().parents[2] / "gateway-toletus" / "main.py"
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location("gateway_main", path)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None and spec.loader is not None
    spec.loader.exec_module(module)
    sys.path.remove(str(path.parent))
    return module


def test_normalize_decision_allow_both_when_direction_unknown():
    gateway = _load_gateway_module()
    decision = gateway.normalize_decision({"allow": True}, "unknown")
    assert decision["allow_entry"] is True
    assert decision["allow_exit"] is True
    assert decision["release_direction"] == "both"


def test_normalize_decision_deny_entry_allow_exit():
    gateway = _load_gateway_module()
    decision_entry = gateway.normalize_decision(
        {"allow_entry": False, "allow_exit": True}, "entry"
    )
    decision_exit = gateway.normalize_decision(
        {"allow_entry": False, "allow_exit": True}, "exit"
    )
    assert decision_entry["release_direction"] is None
    assert decision_exit["release_direction"] == "exit"


def test_normalize_decision_allow_entry_deny_exit():
    gateway = _load_gateway_module()
    decision_entry = gateway.normalize_decision(
        {"allow_entry": True, "allow_exit": False}, "entry"
    )
    decision_exit = gateway.normalize_decision(
        {"allow_entry": True, "allow_exit": False}, "exit"
    )
    assert decision_entry["release_direction"] == "entry"
    assert decision_exit["release_direction"] is None


def test_normalize_decision_deny_both():
    gateway = _load_gateway_module()
    decision = gateway.normalize_decision({"deny_both": True}, "unknown")
    assert decision["allow_entry"] is False
    assert decision["allow_exit"] is False
    assert decision["release_direction"] is None


def test_process_manual_release_queue_acknowledges_execution():
    gateway = _load_gateway_module()
    sent = {}
    acknowledged = []

    class _DummyWriter:
        pass

    async def fake_pull(_client):
        return {
            "release_id": "rel_1",
            "direction": "entry",
            "message": "ENTRADA ALUNO",
            "student_id": "std_1",
        }

    async def fake_ack(_client, *, release_id, status_value, error=None):
        acknowledged.append((release_id, status_value, error))

    async def fake_send(_writer, packet, tx_type, **metadata):
        sent["packet"] = packet
        sent["tx_type"] = tx_type
        sent["metadata"] = metadata

    gateway.pull_manual_release = fake_pull
    gateway.acknowledge_manual_release = fake_ack
    gateway._safe_send = fake_send

    import asyncio

    asyncio.run(gateway.process_manual_release_queue(object(), _DummyWriter()))

    assert sent["tx_type"] == "manual_release"
    assert sent["metadata"]["release_id"] == "rel_1"
    assert sent["metadata"]["release_direction"] == "entry"
    assert acknowledged == [("rel_1", "executed", None)]
