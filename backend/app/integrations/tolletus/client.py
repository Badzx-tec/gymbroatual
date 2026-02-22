from dataclasses import dataclass
from typing import Protocol

import httpx

from app.core.config import get_settings


class TolletusClient(Protocol):
    async def enroll_start(self, student_id: str, device_id: str) -> dict: ...

    async def enroll_confirm(
        self, student_id: str, device_id: str, template: str
    ) -> dict: ...


@dataclass
class MockTolletusClient:
    async def enroll_start(self, student_id: str, device_id: str) -> dict:
        return {
            "provider": "tolletus",
            "mode": "mock",
            "student_id": student_id,
            "device_id": device_id,
            "session_id": f"mock-{student_id[:8]}",
            "instructions": "Posicione o dedo no leitor e confirme no app",
        }

    async def enroll_confirm(
        self, student_id: str, device_id: str, template: str
    ) -> dict:
        return {
            "provider": "tolletus",
            "mode": "mock",
            "student_id": student_id,
            "device_id": device_id,
            "template": template,
            "external_id": f"tpl-{student_id[:8]}",
        }


@dataclass
class HttpTolletusClient:
    base_url: str
    api_key: str

    async def enroll_start(self, student_id: str, device_id: str) -> dict:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{self.base_url}/enroll/start",
                json={"student_id": student_id, "device_id": device_id},
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            response.raise_for_status()
            return response.json()

    async def enroll_confirm(
        self, student_id: str, device_id: str, template: str
    ) -> dict:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{self.base_url}/enroll/confirm",
                json={
                    "student_id": student_id,
                    "device_id": device_id,
                    "template": template,
                },
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            response.raise_for_status()
            return response.json()


def get_tolletus_client() -> TolletusClient:
    settings = get_settings()
    mode = (settings.toletus_mode or "mock").lower()
    if mode == "real":
        if not settings.toletus_api_base_url or not settings.toletus_api_key:
            raise ValueError(
                "TOLETUS_MODE=real requer TOLETUS_API_BASE_URL e TOLETUS_API_KEY definidos no ambiente"
            )
        return HttpTolletusClient(
            base_url=settings.toletus_api_base_url.rstrip("/"),
            api_key=settings.toletus_api_key,
        )
    return MockTolletusClient()
