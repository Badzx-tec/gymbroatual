import pytest
from fastapi import HTTPException

from app.core.deps import require_roles


@pytest.mark.asyncio
async def test_reception_cannot_access_owner_only_role_guard():
    dep = require_roles("OWNER", "MANAGER")
    with pytest.raises(HTTPException) as exc:
        await dep({"role": "RECEPTION"})
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_manager_can_access_manager_guard():
    dep = require_roles("OWNER", "MANAGER")
    actor = await dep({"role": "MANAGER"})
    assert actor["role"] == "MANAGER"
