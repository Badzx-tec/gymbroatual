from fastapi import Depends, Header, HTTPException, status

from app.core.security import safe_jwt_decode
from app.db.mongo import get_db
from app.services.subscription import subscription_allows_login


async def get_current_owner(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Nao autenticado")

    token = authorization.split(" ", 1)[1]
    payload = safe_jwt_decode(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalido")

    owner_id = payload.get("sub")
    db = get_db()
    owner = await db.owners.find_one({"owner_id": owner_id}, {"_id": 0})
    if not owner:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario nao encontrado")
    return owner


async def require_active_subscription(owner: dict = Depends(get_current_owner)) -> dict:
    db = get_db()
    subscription = await db.subscriptions.find_one({"owner_id": owner["owner_id"]}, {"_id": 0})
    if not subscription_allows_login(subscription):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Assinatura inativa",
            headers={"X-Error-Code": "PAYMENT_REQUIRED"},
        )
    return owner
