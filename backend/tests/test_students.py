from datetime import date

from app.models.students import MeasurementIn, StudentIn, WorkoutExercise, WorkoutPlanIn


def test_student_model():
    student = StudentIn(nome="Maria", email="maria@example.com", status="ativo")
    assert student.nome == "Maria"


def test_measurement_model():
    measurement = MeasurementIn(data=date.today(), peso_kg=70.2, bf_percent=18.5)
    assert measurement.peso_kg == 70.2


def test_workout_model():
    workout = WorkoutPlanIn(
        codigo="A", exercicios=[WorkoutExercise(nome="Supino", series="4", reps="10")]
    )
    assert workout.exercicios[0].nome == "Supino"


def test_student_model_allows_blank_email_and_normalizes_cpf():
    student = StudentIn(nome="Maria", email="", cpf="12345678901", status="ativo")
    assert student.email is None
    assert student.cpf == "123.456.789-01"


def test_student_model_converts_blank_numeric_and_dates_to_none():
    student = StudentIn(
        nome="Maria",
        email="maria@example.com",
        altura_cm="",
        peso_kg="",
        idade="",
        data_vencimento="",
        dias_frequencia="",
        status="ativo",
    )
    assert student.altura_cm is None
    assert student.peso_kg is None
    assert student.idade is None
    assert student.data_vencimento is None
    assert student.dias_frequencia is None


def test_student_model_accepts_frontend_payload_shape():
    student = StudentIn(
        nome="LUANA RODRIGUES SILVA",
        email="2@gmail.com",
        cpf="14358820670",
        telefone="",
        plano_id="pln_1771847143",
        tag_rfid="",
        biometria_id="",
        status="ativo",
        data_vencimento="2026-03-01",
        peso_kg="",
        idade="",
        altura_cm="",
        treino="",
        dias_frequencia=0,
    )
    assert student.cpf == "143.588.206-70"
    assert student.telefone is None
    assert student.peso_kg is None
    assert student.idade is None
    assert student.altura_cm is None
    assert student.treino is None
    assert student.dias_frequencia == 0
