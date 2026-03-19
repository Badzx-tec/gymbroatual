from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

# Compatibilidade entre Python 3.10/3.11+
UTC = timezone.utc
SAO_PAULO_TZ = ZoneInfo("America/Sao_Paulo")


def coerce_datetime_utc(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=UTC)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed_date = date.fromisoformat(raw)
            except ValueError:
                return None
            parsed = datetime.combine(parsed_date, time.min)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    return None


def to_sao_paulo(value) -> datetime | None:
    parsed = coerce_datetime_utc(value)
    if not parsed:
        return None
    return parsed.astimezone(SAO_PAULO_TZ)


def sao_paulo_now() -> datetime:
    return datetime.now(SAO_PAULO_TZ)


def sao_paulo_day_bounds(value) -> tuple[datetime, datetime] | tuple[None, None]:
    if value is None:
        return None, None

    parsed_date: date | None = None
    if isinstance(value, datetime):
        parsed_date = to_sao_paulo(value).date()
    elif isinstance(value, date):
        parsed_date = value
    else:
        raw = str(value).strip()
        if not raw:
            return None, None
        try:
            parsed_date = date.fromisoformat(raw)
        except ValueError:
            parsed_dt = coerce_datetime_utc(raw)
            if not parsed_dt:
                return None, None
            parsed_date = to_sao_paulo(parsed_dt).date()

    start = datetime.combine(parsed_date, time.min, tzinfo=SAO_PAULO_TZ).astimezone(UTC)
    end = datetime.combine(parsed_date, time.max, tzinfo=SAO_PAULO_TZ).astimezone(UTC)
    return start, end


def sao_paulo_month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    month_start = datetime(year, month, 1, tzinfo=SAO_PAULO_TZ)
    if month == 12:
        next_month = datetime(year + 1, 1, 1, tzinfo=SAO_PAULO_TZ)
    else:
        next_month = datetime(year, month + 1, 1, tzinfo=SAO_PAULO_TZ)
    return month_start.astimezone(UTC), (next_month.astimezone(UTC) - datetime.resolution)
