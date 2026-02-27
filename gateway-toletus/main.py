import asyncio
import hashlib
import hmac
import json
import os
import secrets
import socket
from datetime import datetime, timezone

import httpx

from protocol import (
    DIRECTION_BOTH,
    DIRECTION_ENTRY,
    DIRECTION_EXIT,
    DIRECTION_UNKNOWN,
    OPER_CREDENTIAL,
    OPER_OPERATIONAL,
    PACKET_SIZE,
    encode_notify_user,
    encode_query_fw,
    encode_query_init_states,
    encode_release_for_direction,
    normalize_direction,
    parse_event,
)


def _log(event: str, **fields) -> None:
    payload = {"event": event, **fields}
    print(f"[gateway] {json.dumps(payload, ensure_ascii=False)}", flush=True)


def _env_str(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = str(value).strip()
    return normalized if normalized else default


def _env_int(name: str, default: int, *, minimum: int | None = None) -> int:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = int(str(raw).strip())
    except ValueError:
        _log("config_invalid_int", env=name, raw=str(raw), using=default)
        return default
    if minimum is not None and value < minimum:
        _log("config_int_below_min", env=name, value=value, minimum=minimum, using=default)
        return default
    return value


def _env_float(name: str, default: float, *, minimum: float | None = None) -> float:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = float(str(raw).strip())
    except ValueError:
        _log("config_invalid_float", env=name, raw=str(raw), using=default)
        return default
    if minimum is not None and value < minimum:
        _log("config_float_below_min", env=name, value=value, minimum=minimum, using=default)
        return default
    return value


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        return default
    value = str(raw).strip().lower()
    if value in {"1", "true", "t", "yes", "y", "on"}:
        return True
    if value in {"0", "false", "f", "no", "n", "off"}:
        return False
    _log("config_invalid_bool", env=name, raw=str(raw), using=default)
    return default


def _as_bool(value, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    raw = str(value).strip().lower()
    if raw in {"1", "true", "t", "yes", "y", "on", "allow", "allowed"}:
        return True
    if raw in {"0", "false", "f", "no", "n", "off", "deny", "denied"}:
        return False
    return default


def _to_direction_set(value) -> set[str]:
    if value is None:
        return set()
    parts: list[str]
    if isinstance(value, str):
        parts = [chunk.strip() for chunk in value.split(",") if chunk.strip()]
    elif isinstance(value, (list, tuple, set)):
        parts = [str(item).strip() for item in value if str(item).strip()]
    else:
        parts = [str(value).strip()]
    result: set[str] = set()
    for item in parts:
        normalized = normalize_direction(item)
        if normalized == DIRECTION_BOTH:
            result.update({DIRECTION_ENTRY, DIRECTION_EXIT})
        elif normalized in {DIRECTION_ENTRY, DIRECTION_EXIT}:
            result.add(normalized)
    return result


TOLETUS_HOST = _env_str("TOLETUS_HOST", "127.0.0.1")
TOLETUS_PORT = _env_int("TOLETUS_PORT", 7878, minimum=1)
SAAS_URL = _env_str("SAAS_URL", "http://localhost:8000")
DEVICE_ID = (
    (os.getenv("DEVICE_ID") or os.getenv("GATEWAY_DEVICE_ID") or "dev_local_1").strip()
    or "dev_local_1"
)
DEVICE_TOKEN = (os.getenv("DEVICE_TOKEN") or os.getenv("GATEWAY_DEVICE_TOKEN") or "").strip()
SIMULATOR = _env_bool("TOLETUS_SIMULATOR", True)
TOLETUS_READ_TIMEOUT = _env_float("TOLETUS_READ_TIMEOUT", 60.0, minimum=0.0)
TOLETUS_RECONNECT_DELAY = _env_float("TOLETUS_RECONNECT_DELAY", 3.0, minimum=0.5)
TOLETUS_PROBE_ON_CONNECT = _env_bool("TOLETUS_PROBE_ON_CONNECT", True)
TOLETUS_PROBE_ON_TIMEOUT = _env_bool("TOLETUS_PROBE_ON_TIMEOUT", True)
TOLETUS_DEFAULT_DIRECTION = normalize_direction(_env_str("TOLETUS_DEFAULT_DIRECTION", "entry"))
SAAS_REQUEST_TIMEOUT = _env_float("SAAS_REQUEST_TIMEOUT", 10.0, minimum=1.0)
TOLETUS_DENY_BEEP = _env_int("TOLETUS_DENY_BEEP", 2, minimum=0)
TOLETUS_DENY_LED = _env_int("TOLETUS_DENY_LED", 1, minimum=0)
TOLETUS_DENY_DURATION_MS = _env_int("TOLETUS_DENY_DURATION_MS", 2000, minimum=0)


def sign_payload(method: str, credential: str, timestamp: str, nonce: str) -> str:
    payload = f"{method}:{credential}:{timestamp}:{nonce}".encode("utf-8")
    return hmac.new(DEVICE_TOKEN.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def build_auth_payload(method: str, credential: str, extras: dict | None = None) -> dict:
    timestamp = datetime.now(timezone.utc).isoformat()
    nonce = secrets.token_hex(8)
    signature = sign_payload(method, credential, timestamp, nonce)
    base = {
        "device_id": DEVICE_ID,
        "method": method,
        "credential": credential,
        "timestamp": timestamp,
        "nonce": nonce,
        "signature": signature,
    }
    if extras:
        base.update(extras)
    return base


def _normalize_event_direction(event: dict) -> tuple[str, str]:
    event_direction = normalize_direction(event.get("direction"))
    if event_direction != DIRECTION_UNKNOWN:
        return event_direction, "event"
    if TOLETUS_DEFAULT_DIRECTION != DIRECTION_UNKNOWN:
        return TOLETUS_DEFAULT_DIRECTION, "default"
    return DIRECTION_UNKNOWN, "unknown"


def _extract_allow_matrix(decision: dict) -> tuple[bool, bool]:
    allow_default = _as_bool(decision.get("allow"), False)
    allow_entry = allow_default
    allow_exit = allow_default
    explicit = False

    if "allow_entry" in decision:
        allow_entry = _as_bool(decision.get("allow_entry"))
        explicit = True
    if "allow_exit" in decision:
        allow_exit = _as_bool(decision.get("allow_exit"))
        explicit = True

    if _as_bool(decision.get("deny_entry"), False):
        allow_entry = False
        explicit = True
    if _as_bool(decision.get("deny_exit"), False):
        allow_exit = False
        explicit = True
    if _as_bool(decision.get("allow_both"), False):
        allow_entry = True
        allow_exit = True
        explicit = True
    if _as_bool(decision.get("deny_both"), False):
        allow_entry = False
        allow_exit = False
        explicit = True

    allowed = _to_direction_set(decision.get("allowed_directions"))
    if not allowed:
        allowed = _to_direction_set(decision.get("allow_directions"))
    if allowed:
        allow_entry = DIRECTION_ENTRY in allowed
        allow_exit = DIRECTION_EXIT in allowed
        explicit = True

    direction_hint = normalize_direction(decision.get("direction"))
    if not explicit and direction_hint in {DIRECTION_ENTRY, DIRECTION_EXIT, DIRECTION_BOTH}:
        if direction_hint == DIRECTION_ENTRY:
            allow_entry = allow_default
            allow_exit = False
        elif direction_hint == DIRECTION_EXIT:
            allow_entry = False
            allow_exit = allow_default
        else:
            allow_entry = allow_default
            allow_exit = allow_default

    return allow_entry, allow_exit


def _select_release_direction(
    allow_entry: bool,
    allow_exit: bool,
    event_direction: str,
    command_direction_hint: str,
) -> str | None:
    hint = normalize_direction(command_direction_hint)
    if hint == DIRECTION_ENTRY:
        return DIRECTION_ENTRY if allow_entry else None
    if hint == DIRECTION_EXIT:
        return DIRECTION_EXIT if allow_exit else None
    if hint == DIRECTION_BOTH:
        if allow_entry and allow_exit:
            return DIRECTION_BOTH
        if allow_entry:
            return DIRECTION_ENTRY
        if allow_exit:
            return DIRECTION_EXIT
        return None

    direction = normalize_direction(event_direction)
    if direction == DIRECTION_ENTRY:
        return DIRECTION_ENTRY if allow_entry else None
    if direction == DIRECTION_EXIT:
        return DIRECTION_EXIT if allow_exit else None
    if direction == DIRECTION_BOTH:
        if allow_entry and allow_exit:
            return DIRECTION_BOTH
        if allow_entry:
            return DIRECTION_ENTRY
        if allow_exit:
            return DIRECTION_EXIT
        return None

    if allow_entry and allow_exit:
        return DIRECTION_BOTH
    if allow_entry:
        return DIRECTION_ENTRY
    if allow_exit:
        return DIRECTION_EXIT
    return None


def normalize_decision(decision: dict, event_direction: str) -> dict:
    allow_entry, allow_exit = _extract_allow_matrix(decision)
    command_hint = normalize_direction(decision.get("command_direction"))
    release_direction = _select_release_direction(
        allow_entry=allow_entry,
        allow_exit=allow_exit,
        event_direction=event_direction,
        command_direction_hint=command_hint,
    )
    allow_now = release_direction is not None
    blocked = []
    if not allow_entry:
        blocked.append(DIRECTION_ENTRY)
    if not allow_exit:
        blocked.append(DIRECTION_EXIT)

    message = str(decision.get("message") or "").strip()
    if not message:
        message = "LIBERADO" if allow_now else "Acesso negado"

    return {
        "allow": allow_now,
        "allow_entry": allow_entry,
        "allow_exit": allow_exit,
        "blocked_directions": blocked,
        "event_direction": normalize_direction(event_direction),
        "release_direction": release_direction,
        "message": message,
        "beep": decision.get("beep"),
        "led": decision.get("led"),
        "raw": decision,
    }


async def request_decision(client: httpx.AsyncClient, event: dict, event_direction: str) -> dict:
    payload = build_auth_payload(
        event["method"],
        event["credential"],
        extras={
            "direction": event_direction,
            "event_kind": event.get("kind"),
            "event_type": event.get("type"),
            "command": event.get("command"),
            "raw": event.get("raw"),
        },
    )
    response = await client.post(
        f"{SAAS_URL.rstrip('/')}/api/turnstiles/decision",
        json=payload,
        headers={"X-Device-Token": DEVICE_TOKEN},
    )
    response.raise_for_status()
    parsed = response.json()
    if not isinstance(parsed, dict):
        raise RuntimeError("Invalid decision response (non-object)")
    return parsed


async def post_event(
    client: httpx.AsyncClient,
    event: dict,
    *,
    normalized_decision: dict | None = None,
    send_message: str | None = None,
) -> None:
    method = str(event.get("method") or "").strip().lower()
    if method not in {"rfid", "keypad", "biometry", "passage"}:
        return

    payload = build_auth_payload(
        method,
        str(event.get("credential") or ""),
        extras={
            "direction": event.get("direction"),
            "event_kind": event.get("kind"),
            "event_type": event.get("type"),
            "command": event.get("command"),
            "raw": event.get("raw"),
            "count": event.get("count"),
        },
    )
    if normalized_decision is not None:
        payload["decision"] = bool(normalized_decision.get("allow"))
        payload["message"] = send_message or normalized_decision.get("message")
        payload["allow_entry"] = bool(normalized_decision.get("allow_entry"))
        payload["allow_exit"] = bool(normalized_decision.get("allow_exit"))
        payload["release_direction"] = normalized_decision.get("release_direction")

    try:
        response = await client.post(
            f"{SAAS_URL.rstrip('/')}/api/turnstiles/events",
            json=payload,
            headers={"X-Device-Token": DEVICE_TOKEN},
        )
        response.raise_for_status()
    except Exception as exc:  # pragma: no cover - resiliencia runtime
        _log("event_post_error", error=f"{type(exc).__name__}: {exc}", method=method)


async def _safe_send(writer: asyncio.StreamWriter, packet: bytes, tx_type: str, **metadata) -> None:
    writer.write(packet)
    await writer.drain()
    _log("tx_sent", tx_type=tx_type, **metadata)


async def _send_probe(writer: asyncio.StreamWriter, source: str) -> None:
    await _safe_send(writer, encode_query_fw(), "probe_query_fw", source=source)
    await _safe_send(
        writer, encode_query_init_states(), "probe_query_init_states", source=source
    )


async def apply_decision_to_device(
    writer: asyncio.StreamWriter,
    event: dict,
    normalized_decision: dict,
) -> None:
    release_direction = normalized_decision.get("release_direction")
    message = str(normalized_decision.get("message") or "LIBERADO")
    if release_direction:
        packet = encode_release_for_direction(release_direction, message=message)
        await _safe_send(
            writer,
            packet,
            "release",
            event_method=event.get("method"),
            event_direction=normalized_decision.get("event_direction"),
            release_direction=release_direction,
            allow_entry=normalized_decision.get("allow_entry"),
            allow_exit=normalized_decision.get("allow_exit"),
        )
        return

    packet = encode_notify_user(
        duration_ms=TOLETUS_DENY_DURATION_MS,
        beep=TOLETUS_DENY_BEEP,
        color=TOLETUS_DENY_LED,
        show_text=1,
    )
    await _safe_send(
        writer,
        packet,
        "deny_notify",
        event_method=event.get("method"),
        event_direction=normalized_decision.get("event_direction"),
        blocked_directions=normalized_decision.get("blocked_directions"),
    )


async def handle_credential_event(
    client: httpx.AsyncClient,
    writer: asyncio.StreamWriter,
    event: dict,
) -> None:
    event_direction, direction_source = _normalize_event_direction(event)
    _log(
        "credential_rx",
        method=event.get("method"),
        credential=event.get("credential"),
        event_direction=event_direction,
        direction_source=direction_source,
        command=f"0x{int(event.get('command') or 0):04x}",
    )

    decision = await request_decision(client, event, event_direction)
    normalized = normalize_decision(decision, event_direction)
    _log(
        "decision_rx",
        method=event.get("method"),
        event_direction=event_direction,
        allow_entry=normalized["allow_entry"],
        allow_exit=normalized["allow_exit"],
        release_direction=normalized["release_direction"],
        blocked_directions=normalized["blocked_directions"],
        message=normalized["message"],
    )

    await apply_decision_to_device(writer, event, normalized)
    await post_event(client, event, normalized_decision=normalized)


async def handle_operational_event(client: httpx.AsyncClient, event: dict) -> None:
    _log(
        "operational_rx",
        op_type=event.get("type"),
        direction=event.get("direction"),
        count=event.get("count"),
        command=f"0x{int(event.get('command') or 0):04x}",
    )
    if event.get("type") == "passage":
        await post_event(client, event)


async def run_simulator(client: httpx.AsyncClient) -> None:
    _log("simulator_enabled")
    sample_events = [
        {
            "kind": OPER_CREDENTIAL,
            "type": "credential",
            "method": "rfid",
            "credential": "0000001",
            "direction": DIRECTION_ENTRY,
            "command": 0x0301,
            "raw": "",
        },
        {
            "kind": OPER_CREDENTIAL,
            "type": "credential",
            "method": "biometry",
            "credential": "55",
            "direction": DIRECTION_ENTRY,
            "command": 0x0306,
            "raw": "",
        },
        {
            "kind": OPER_CREDENTIAL,
            "type": "credential",
            "method": "keypad",
            "credential": "1234",
            "direction": DIRECTION_EXIT,
            "command": 0x0303,
            "raw": "",
        },
    ]

    while True:
        for event in sample_events:
            try:
                event_direction, _ = _normalize_event_direction(event)
                decision = await request_decision(client, event, event_direction)
                normalized = normalize_decision(decision, event_direction)
                _log(
                    "simulator_decision",
                    method=event["method"],
                    credential=event["credential"],
                    event_direction=event_direction,
                    allow_entry=normalized["allow_entry"],
                    allow_exit=normalized["allow_exit"],
                    release_direction=normalized["release_direction"],
                )
                await post_event(client, event, normalized_decision=normalized)
            except Exception as exc:  # pragma: no cover - runtime resilience
                _log("simulator_error", error=f"{type(exc).__name__}: {exc}")
            await asyncio.sleep(3)


async def run_tcp(client: httpx.AsyncClient) -> None:
    while True:
        writer = None
        try:
            _log("tcp_connecting", host=TOLETUS_HOST, port=TOLETUS_PORT)
            reader, writer = await asyncio.open_connection(TOLETUS_HOST, TOLETUS_PORT)

            sock = writer.get_extra_info("socket")
            if sock is not None:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)

            _log("tcp_connected", host=TOLETUS_HOST, port=TOLETUS_PORT)

            if TOLETUS_PROBE_ON_CONNECT:
                await _send_probe(writer, "connect")

            while True:
                try:
                    if TOLETUS_READ_TIMEOUT > 0:
                        packet = await asyncio.wait_for(
                            reader.readexactly(PACKET_SIZE),
                            timeout=TOLETUS_READ_TIMEOUT,
                        )
                    else:
                        packet = await reader.readexactly(PACKET_SIZE)
                except asyncio.TimeoutError:
                    _log("tcp_read_timeout", timeout_s=TOLETUS_READ_TIMEOUT)
                    if TOLETUS_PROBE_ON_TIMEOUT:
                        await _send_probe(writer, "timeout")
                    continue
                except asyncio.IncompleteReadError as exc:
                    _log(
                        "tcp_socket_closed",
                        expected=exc.expected,
                        partial_size=len(exc.partial),
                    )
                    break

                try:
                    event = parse_event(packet)
                except Exception as exc:
                    _log("packet_invalid", error=f"{type(exc).__name__}: {exc}", raw=packet.hex())
                    continue

                if event.get("kind") == OPER_CREDENTIAL:
                    try:
                        await handle_credential_event(client, writer, event)
                    except (ConnectionResetError, BrokenPipeError) as exc:
                        _log("tcp_write_failure", error=f"{type(exc).__name__}: {exc}")
                        break
                    except Exception as exc:
                        _log("credential_process_error", error=f"{type(exc).__name__}: {exc}")
                    continue
                if event.get("kind") == OPER_OPERATIONAL:
                    try:
                        await handle_operational_event(client, event)
                    except Exception as exc:
                        _log("operational_process_error", error=f"{type(exc).__name__}: {exc}")
                    continue

                _log(
                    "packet_unhandled",
                    command=f"0x{int(event.get('command') or 0):04x}",
                    raw=event.get("raw"),
                )
        except Exception as exc:  # pragma: no cover - runtime resilience
            _log("tcp_loop_error", error=f"{type(exc).__name__}: {exc}")
        finally:
            if writer is not None:
                try:
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    pass

        _log("tcp_reconnect_wait", delay_s=TOLETUS_RECONNECT_DELAY)
        await asyncio.sleep(TOLETUS_RECONNECT_DELAY)


async def main() -> None:
    if not DEVICE_TOKEN:
        raise RuntimeError("DEVICE_TOKEN is required")

    _log(
        "startup",
        simulator=SIMULATOR,
        saas_url=SAAS_URL,
        device_id=DEVICE_ID,
        toletus_host=TOLETUS_HOST,
        toletus_port=TOLETUS_PORT,
        read_timeout=TOLETUS_READ_TIMEOUT,
        reconnect_delay=TOLETUS_RECONNECT_DELAY,
        probe_on_connect=TOLETUS_PROBE_ON_CONNECT,
        probe_on_timeout=TOLETUS_PROBE_ON_TIMEOUT,
        default_direction=TOLETUS_DEFAULT_DIRECTION,
    )
    timeout = httpx.Timeout(timeout=SAAS_REQUEST_TIMEOUT)
    async with httpx.AsyncClient(timeout=timeout) as client:
        if SIMULATOR:
            await run_simulator(client)
        else:
            await run_tcp(client)


if __name__ == "__main__":
    asyncio.run(main())
