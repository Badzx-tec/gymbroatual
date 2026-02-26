import re


def safe_contains_regex(
    raw_value: str | None,
    *,
    max_length: int = 80,
) -> str | None:
    """
    Escape user input before using it in Mongo `$regex`.
    This prevents regex meta-chars from becoming executable patterns.
    """
    if raw_value is None:
        return None
    cleaned = str(raw_value).strip()
    if not cleaned:
        return None
    bounded = cleaned[:max_length]
    return re.escape(bounded)
