import smtplib
from datetime import UTC, datetime
from email.message import EmailMessage

from app.core.config import get_settings
from app.db.mongo import get_db


async def send_email_code(email: str, code: str) -> bool:
    settings = get_settings()
    subject = "Seu codigo de verificacao GymBro"
    body_text = f"Seu codigo de verificacao e: {code}. Ele expira em 15 minutos."

    if settings.smtp_host and settings.smtp_user and settings.smtp_password:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = settings.smtp_from
        msg["To"] = email
        msg.set_content(body_text)
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_starttls:
                smtp.starttls()
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        return True

    db = get_db()
    await db.email_logs.insert_one(
        {
            "email": email,
            "subject": subject,
            "body": body_text,
            "sent_at": datetime.now(UTC),
            "mode": "log-only",
        }
    )
    return False
