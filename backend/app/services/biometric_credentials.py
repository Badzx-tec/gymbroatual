import re


def normalize_biometric_credential(value) -> str | None:
    if value is None:
        return None

    cleaned = str(value).strip()
    if not cleaned:
        return None

    if cleaned.isdigit():
        normalized = cleaned.lstrip("0")
        return normalized or "0"

    return cleaned


def biometric_lookup_candidates(value) -> list[str]:
    raw = str(value or "").strip()
    if not raw:
        return []

    normalized = normalize_biometric_credential(raw)
    candidates: list[str] = []
    for item in (raw, normalized):
        if item and item not in candidates:
            candidates.append(item)
    return candidates


def biometric_lookup_regex(value) -> re.Pattern[str] | None:
    raw = str(value or "").strip()
    if not raw:
        return None

    if raw.isdigit():
        normalized = normalize_biometric_credential(raw)
        if normalized == "0":
            pattern = r"^\s*0+\s*$"
        else:
            pattern = rf"^\s*0*{re.escape(normalized)}\s*$"
        return re.compile(pattern)

    return re.compile(rf"^\s*{re.escape(raw)}\s*$")


def mask_biometric_credential(value) -> str | None:
    cleaned = str(value or "").strip()
    if not cleaned:
        return None
    if len(cleaned) <= 4:
        return "*" * len(cleaned)
    return f"{'*' * (len(cleaned) - 4)}{cleaned[-4:]}"
