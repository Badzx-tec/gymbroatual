import asyncio
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timezone

import httpx

from protocol import PACKET_SIZE, encode_notify_user, encode_release_entry, parse_event

TOLETUS_HOST = os.getenv("TOLETUS_HOST", "127.0.0.1")
TOLETUS_PORT = int(os.getenv("TOLETUS_PORT", "7878"))
SAAS_URL = os.getenv("SAAS_URL", "http://localhost:8000")
DEVICE_ID = os.getenv("DEVICE_ID") or os.getenv("GATEWAY_DEVICE_ID", "dev_local_1")
DEVICE_TOKEN = os.getenv("DEVICE_TOKEN") or os.getenv("GATEWAY_DEVICE_TOKEN", "")
SIMULATOR = os.getenv("TOLETUS_SIMULATOR", "true").lower() == "true"
TOLETUS_READ_TIMEOUT = int(os.getenv("TOLETUS_READ_TIMEOUT", "60"))
TOLETUS_RECONNECT_DELAY = int(os.getenv("TOLETUS_RECONNECT_DELAY", "3"))


def sign_payload(method: str, credential: str, timestamp: str, nonce: str) -> str:
    payload = f"{method}:{credential}:{timestamp}:{nonce}".encode("utf-8")
    return hmac.new(DEVICE_TOKEN.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def build_auth_payload(method: str, credential: str) -> dict:
    timestamp = datetime.now(timezone.utc).isoformat()
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
        event_payload = build_auth_payload(event["method"], event["credential"])
        await client.post(
            f"{SAAS_URL.rstrip('/')}/api/turnstiles/events",
            json={
                **event_payload,
                "decision": decision.get("allow"),
                "message": decision.get("message"),
            },
            headers={"X-Device-Token": DEVICE_TOKEN},
        )
        return decision


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
                decision = await request_decision(event)
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
        reader = None
        writer = None
        try:
            print(f"[gateway] connecting to Toletus at {TOLETUS_HOST}:{TOLETUS_PORT}")
            reader, writer = await asyncio.open_connection(TOLETUS_HOST, TOLETUS_PORT)
            while True:
                try:
                    if TOLETUS_READ_TIMEOUT > 0:
                        packet = await asyncio.wait_for(
                            reader.readexactly(PACKET_SIZE), timeout=TOLETUS_READ_TIMEOUT
                        )
                    else:
                        packet = await reader.readexactly(PACKET_SIZE)
                except asyncio.TimeoutError:
                    print(
                        f"[gateway] read timeout ({TOLETUS_READ_TIMEOUT}s); waiting next packet"
                    )
                    continue
                except asyncio.IncompleteReadError:
                    print("[gateway] socket closed by Toletus; reconnecting")
                    break

                try:
                    event = parse_event(packet)
                except Exception as exc:
                    print("[gateway] invalid packet:", str(exc))
                    continue

                if event["method"] == "unknown":
                    continue

                try:
                    decision = await request_decision(event)
                except Exception as exc:
                    print("[gateway] decision error:", str(exc))
                    continue

                if decision.get("allow"):
                    message = (decision.get("message") or "LIBERADO")[:16]
                    writer.write(encode_release_entry(message))
                else:
                    writer.write(encode_notify_user(code=2, duration=2, led=2))
                await writer.drain()
        except Exception as exc:
            print("[gateway] tcp loop error:", str(exc))
        finally:
            if writer is not None:
                writer.close()
                await writer.wait_closed()

        wait_seconds = max(1, TOLETUS_RECONNECT_DELAY)
        print(f"[gateway] reconnecting in {wait_seconds}s")
        await asyncio.sleep(wait_seconds)


async def main() -> None:
    if not DEVICE_TOKEN:
        raise RuntimeError("DEVICE_TOKEN is required")
    if SIMULATOR:
        await run_simulator()
    else:
        await run_tcp()


if __name__ == "__main__":
    asyncio.run(main())
