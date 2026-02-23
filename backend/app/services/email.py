import smtplib
from datetime import datetime
from email.message import EmailMessage

from app.core.config import get_settings
from app.core.time import UTC
from app.db.mongo import get_db


class EmailDeliveryError(RuntimeError):
    """Raised when SMTP delivery fails in production."""


async def send_email_code(email: str, code: str) -> bool:
    settings = get_settings()
    db = get_db()
    subject = "Seu codigo de verificacao GymBro"
    body_text = f"Seu codigo de verificacao e: {code}. Ele expira em 15 minutos."
    body_html = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #111;">
        <h2>Verificacao de e-mail</h2>
        <p>Seu codigo de verificacao no GymBro:</p>
        <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">{code}</p>
        <p>Esse codigo expira em 15 minutos.</p>
      </body>
    </html>
    """.strip()

    if settings.smtp_host and settings.smtp_user and settings.smtp_password:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = settings.smtp_from
            msg["To"] = email
            msg.set_content(body_text)
            msg.add_alternative(body_html, subtype="html")
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
                if settings.smtp_starttls:
                    smtp.starttls()
                smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.send_message(msg)
            return True
        except (OSError, smtplib.SMTPException) as exc:
            await db.email_logs.insert_one(
                {
                    "email": email,
                    "subject": subject,
                    "body": body_text,
                    "body_html": body_html,
                    "sent_at": datetime.now(UTC),
                    "mode": "smtp-error",
                    "error": str(exc),
                }
            )
            if settings.environment == "prod":
                raise EmailDeliveryError("Falha ao enviar email de verificacao") from exc

    await db.email_logs.insert_one(
        {
            "email": email,
            "subject": subject,
            "body": body_text,
            "body_html": body_html,
            "sent_at": datetime.now(UTC),
            "mode": "log-only",
        }
    )
    return False
