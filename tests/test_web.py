from fastapi.testclient import TestClient

from maester import __version__
from maester.web import create_app


def test_health_is_open_and_reports_version():
    client = TestClient(create_app())
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "version": __version__}
