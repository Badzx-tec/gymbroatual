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
