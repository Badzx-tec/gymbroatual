import pytest

from app.services import email as email_service


class _FakeEmailLogs:
    def __init__(self):
        self.records = []

    async def insert_one(self, doc):
        self.records.append(doc)


class _FakeDb:
    def __init__(self):
        self.email_logs = _FakeEmailLogs()


class _Settings:
    smtp_host = "smtp.example.com"
    smtp_port = 587
    smtp_user = "user"
    smtp_password = "pass"
    smtp_from = "no-reply@example.com"
    smtp_starttls = True
    environment = "dev"


class _FailingSMTP:
    def __init__(self, *_args, **_kwargs):
        raise OSError("Network is unreachable")


@pytest.mark.asyncio
async def test_send_email_code_falls_back_to_log_in_dev(monkeypatch):
    db = _FakeDb()
    settings = _Settings()
    settings.environment = "dev"

    monkeypatch.setattr(email_service, "get_settings", lambda: settings)
    monkeypatch.setattr(email_service, "get_db", lambda: db)
    monkeypatch.setattr(email_service.smtplib, "SMTP", _FailingSMTP)

    sent = await email_service.send_email_code("owner@example.com", "123456")
    assert sent is False
    assert db.email_logs.records[-1]["mode"] == "log-only"


@pytest.mark.asyncio
async def test_send_email_code_raises_in_prod(monkeypatch):
    db = _FakeDb()
    settings = _Settings()
    settings.environment = "prod"

    monkeypatch.setattr(email_service, "get_settings", lambda: settings)
    monkeypatch.setattr(email_service, "get_db", lambda: db)
    monkeypatch.setattr(email_service.smtplib, "SMTP", _FailingSMTP)

    with pytest.raises(email_service.EmailDeliveryError):
        await email_service.send_email_code("owner@example.com", "123456")
    assert db.email_logs.records[-1]["mode"] == "smtp-error"
