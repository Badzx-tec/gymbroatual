from app.core.security import create_access_token, safe_jwt_decode, verification_code_hash
from app.routes.billing import status_from_action
from app.services.subscription import initial_subscription, subscription_allows_login


def test_access_token_roundtrip():
    token = create_access_token("owner_123")
    payload = safe_jwt_decode(token)
    assert payload is not None
    assert payload["sub"] == "owner_123"


def test_verification_code_hash_stable():
    a = verification_code_hash("owner@example.com", "123456")
    b = verification_code_hash("owner@example.com", "123456")
    c = verification_code_hash("owner@example.com", "654321")
    assert a == b
    assert a != c


def test_trial_subscription_allows_login():
    sub = initial_subscription("owner_123")
    assert subscription_allows_login(sub)


def test_status_from_action_mapping():
    assert status_from_action("subscription_cancelled") == "canceled"
    assert status_from_action("payment_rejected") == "past_due"
    assert status_from_action("payment_approved") == "active"
