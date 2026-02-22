from datetime import UTC, datetime

from app.routes.turnstiles import _evaluate_student_access


def test_turnstile_access_denied_when_manual_block():
    now = datetime(2026, 2, 22, 10, 0, tzinfo=UTC)
    student = {"status": "ativo", "access_blocked": True}
    allow, reason, _details = _evaluate_student_access(student, now)
    assert allow is False
    assert reason == "student_manual_block"


def test_turnstile_access_denied_when_outside_weekday():
    now = datetime(2026, 2, 22, 10, 0, tzinfo=UTC)  # sunday (6)
    student = {"status": "ativo", "allowed_weekdays": [0, 1, 2, 3, 4]}
    allow, reason, _details = _evaluate_student_access(student, now)
    assert allow is False
    assert reason == "outside_allowed_weekday"


def test_turnstile_access_allowed_when_rules_pass():
    now = datetime(2026, 2, 20, 10, 0, tzinfo=UTC)  # friday (4)
    student = {
        "status": "ativo",
        "allowed_weekdays": [0, 1, 2, 3, 4, 5, 6],
        "allowed_time_start": "08:00",
        "allowed_time_end": "22:00",
    }
    allow, reason, _details = _evaluate_student_access(student, now)
    assert allow is True
    assert reason == "ok"
