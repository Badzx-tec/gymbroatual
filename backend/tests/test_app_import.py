from app.main import app


def test_app_import_and_health_route_present():
    paths = {route.path for route in app.routes}
    assert '/health' in paths
    assert '/api/health' in paths
