import asyncio
import hashlib
import hmac
import json
import os
import secrets
import socket
from datetime import UTC, datetime

import httpx

from protocol import (
    PACKET_SIZE,
    encode_notify_user,
    encode_query_fw,
    encode_query_init_states,
    encode_release_both,
    encode_release_entry,
    encode_release_exit,
    parse_notification,
    parse_packet,
)

TOLETUS_HOST = os.getenv("TOLETUS_HOST", "127.0.0.1")
TOLETUS_PORT = int(os.getenv("TOLETUS_PORT", "7878"))
SAAS_URL = os.getenv("SAAS_URL", "http://localhost:8000")
DEVICE_ID = os.getenv("DEVICE_ID") or os.getenv("GATEWAY_DEVICE_ID", "dev_local_1")
DEVICE_TOKEN = os.getenv("DEVICE_TOKEN") or os.getenv("GATEWAY_DEVICE_TOKEN", "")
SIMULATOR = os.getenv("TOLETUS_SIMULATOR", "true").lower() == "true"
READ_TIMEOUT = float(os.getenv("TOLETUS_READ_TIMEOUT", "60"))
RECONNECT_DELAY = float(os.getenv("TOLETUS_RECONNECT_DELAY", "3"))


def _env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


PROBE_ON_CONNECT = _env_flag("TOLETUS_PROBE_ON_CONNECT", True)
PROBE_ON_TIMEOUT = _env_flag("TOLETUS_PROBE_ON_TIMEOUT", True)


def sign_payload(method: str, credential: str, timestamp: str, nonce: str) -> str:
    payload = f"{method}:{credential}:{timestamp}:{nonce}".encode("utf-8")
    return hmac.new(DEVICE_TOKEN.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def build_auth_payload(method: str, credential: str) -> dict:
    timestamp = datetime.now(UTC).isoformat()
    nonce = secrets.token_hex(8)
    signature = sign_payload(method, credential, timestamp, nonce)
    return {
        "device_id": DEVICE_ID,
        "method": method,
        "credential": credential,
        "timestamp": timestamp,
        "nonce": nonce,
        "signature": signature,
    }


async def post_event(
    method: str,
    credential: str,
    *,
    decision: bool | None = None,
    message: str | None = None,
    raw: str | None = None,
) -> None:
    payload = build_auth_payload(method, credential)
    body = {**payload}
    if decision is not None:
        body["decision"] = decision
    if message:
        body["message"] = message
    if raw:
        body["raw"] = raw

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f"{SAAS_URL.rstrip('/')}/api/turnstiles/events",
            json=body,
            headers={"X-Device-Token": DEVICE_TOKEN},
        )
        response.raise_for_status()


async def request_decision(event: dict) -> dict:
    payload = build_auth_payload(event["method"], event["credential"])

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f"{SAAS_URL.rstrip('/')}/api/turnstiles/decision",
            json=payload,
            headers={"X-Device-Token": DEVICE_TOKEN},
        )
        response.raise_for_status()
        decision = response.json()

        return decision


async def request_decision_and_log(event: dict, *, raw: str | None = None) -> dict:
    decision = await request_decision(event)
    try:
        await post_event(
            event["method"],
            event["credential"],
            decision=bool(decision.get("allow")),
            message=decision.get("message"),
            raw=raw,
        )
    except Exception as exc:
        print("[gateway] events post error:", str(exc), flush=True)
    return decision


async def safe_send(writer: asyncio.StreamWriter, packet: bytes) -> None:
    writer.write(packet)
    await writer.drain()


def _map_operational_event(notification: dict) -> dict:
    event_type = str(notification.get("type") or "unknown")
    if event_type == "passage":
        direction = str(notification.get("direction") or "unknown")
        count = int(notification.get("count") or 0)
        return {
            "method": "passage",
            "credential": f"{direction}:{count}",
            "message": "passage",
        }
    return {
        "method": "passage",
        "credential": event_type,
        "message": event_type,
    }


async def apply_decision_to_toletus(
    writer: asyncio.StreamWriter, decision: dict
) -> None:
    allow = bool(decision.get("allow"))
    direction = str(decision.get("direction") or "entry").strip().lower()
    message = (decision.get("message") or "").strip()

    if allow:
        if direction == "exit":
            packet = encode_release_exit(message or "LIBERADO")
        elif direction in {"both", "bidirectional"}:
            packet = encode_release_both(message or "LIBERADO")
        else:
            packet = encode_release_entry(message or "LIBERADO")
        await safe_send(writer, packet)
        print(f"[gateway] TX allow dir={direction}", flush=True)
        return

    led = 2 if str(decision.get("led") or "").strip().lower() == "green" else 1
    ttl = int(decision.get("ttl") or 2)
    ttl = max(1, min(ttl, 255))
    await safe_send(writer, encode_notify_user(code=2, duration=ttl, led=led))
    print("[gateway] TX deny notify_user", flush=True)


async def _read_packet(reader: asyncio.StreamReader) -> bytes:
    if READ_TIMEOUT > 0:
        return await asyncio.wait_for(
            reader.readexactly(PACKET_SIZE), timeout=READ_TIMEOUT
        )
    return await reader.readexactly(PACKET_SIZE)


async def run_simulator() -> None:
    print("[gateway] simulator mode enabled")
    sample_events = [
        {"method": "rfid", "credential": "0000001"},
        {"method": "keypad", "credential": "1234"},
        {"method": "biometry", "credential": "55"},
    ]
    while True:
        for event in sample_events:
            try:
                decision = await request_decision_and_log(event)
                print(
                    "[gateway] decision",
                    json.dumps(
                        {"event": event, "decision": decision}, ensure_ascii=False
                    ),
                )
            except Exception as exc:
                print("[gateway] decision error:", str(exc))
            await asyncio.sleep(3)


async def run_tcp() -> None:
    while True:
        writer: asyncio.StreamWriter | None = None
        try:
            print(
                f"[gateway] conectando LiteNet2 em {TOLETUS_HOST}:{TOLETUS_PORT}",
                flush=True,
            )
            reader, writer = await asyncio.open_connection(TOLETUS_HOST, TOLETUS_PORT)
            sock = writer.get_extra_info("socket")
            if sock:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

            print("[gateway] TCP conectado", flush=True)

            if PROBE_ON_CONNECT:
                await safe_send(writer, encode_query_fw())
                await safe_send(writer, encode_query_init_states())

            while True:
                try:
                    packet = await _read_packet(reader)
                except asyncio.TimeoutError:
                    if PROBE_ON_TIMEOUT:
                        print("[gateway] timeout de leitura; enviando probe", flush=True)
                        try:
                            await safe_send(writer, encode_query_init_states())
                        except Exception as exc:
                            print(
                                "[gateway] erro enviando probe, reconectando:",
                                str(exc),
                                flush=True,
                            )
                            break
                    continue
                except asyncio.IncompleteReadError:
                    print(
                        "[gateway] conexao fechada pela catraca (EOF). Reconectando...",
                        flush=True,
                    )
                    break

                try:
                    decoded = parse_packet(packet)
                except ValueError as exc:
                    print(
                        f"[gateway] pacote invalido: {exc} | raw={packet.hex()}",
                        flush=True,
                    )
                    continue

                notification = parse_notification(decoded.command, decoded.data)
                print(
                    f"[gateway] rx cmd=0x{decoded.command:04x} data={decoded.data.hex()} ev={notification}",
                    flush=True,
                )

                if not notification:
                    continue

                if notification.get("kind") == "operational":
                    op_event = _map_operational_event(notification)
                    try:
                        await post_event(
                            op_event["method"],
                            op_event["credential"],
                            message=op_event["message"],
                            raw=packet.hex(),
                        )
                    except Exception as exc:
                        print(
                            "[gateway] erro ao enviar evento operacional:",
                            str(exc),
                            flush=True,
                        )
                    continue

                credential_event = {
                    "method": notification["method"],
                    "credential": notification["credential"],
                }
                if not credential_event["credential"]:
                    print("[gateway] credencial vazia, ignorando", flush=True)
                    continue

                try:
                    decision = await request_decision_and_log(
                        credential_event, raw=packet.hex()
                    )
                    print(
                        "[gateway] decision",
                        json.dumps(
                            {"event": credential_event, "decision": decision},
                            ensure_ascii=False,
                        ),
                        flush=True,
                    )
                    await apply_decision_to_toletus(writer, decision)
                except Exception as exc:
                    print("[gateway] erro ao decidir/liberar:", str(exc), flush=True)

        except Exception as exc:
            print(
                f"[gateway] erro de conexao/protocolo: {type(exc).__name__}: {exc}",
                flush=True,
            )
        finally:
            if writer:
                try:
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    pass

        await asyncio.sleep(RECONNECT_DELAY)


async def main() -> None:
    if not DEVICE_TOKEN:
        raise RuntimeError("DEVICE_TOKEN is required")
    if SIMULATOR:
        await run_simulator()
    else:
        await run_tcp()


if __name__ == "__main__":
    asyncio.run(main())
