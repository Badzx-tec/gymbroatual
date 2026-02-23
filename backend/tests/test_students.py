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
<<<<<<< ours


def test_student_model_allows_blank_email_and_normalizes_cpf():
    student = StudentIn(nome="Maria", email="", cpf="12345678901", status="ativo")
    assert student.email is None
    assert student.cpf == "123.456.789-01"
=======
>>>>>>> theirs
