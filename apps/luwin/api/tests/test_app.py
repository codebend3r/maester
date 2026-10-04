import logging
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from luwin.agent.tools import ToolRegistry
from luwin.app import build, build_services, run
from luwin.config import RenamedConfig, load_settings
from luwin.notify import AdminPost, LogNotifier
from luwin.registry import Registry
from luwin.store import Store


def test_build_wires_everything_with_injected_pieces():
    cfg = load_settings({})
    store = Store(":memory:")
    app = build(
        cfg, services=SimpleNamespace(), model_client=object(), tools=ToolRegistry(), store=store
    )
    assert app.agent.model == "claude-opus-5-5" and app.agent.effort == "medium"
    assert app.console.chat is app.chat and not hasattr(app, "bot")
    assert app.web.title == "luwin"
    # Mounted and gated: without the secret, Seerr's route refuses rather than 404s.
    assert TestClient(app.web).post("/webhooks/seerr", json={}).status_code == 401
    store.close()


def test_build_services_creates_one_client_per_host():
    cfg = load_settings(
        {
            "SEERR_URL": "http://s",
            "PLEX_URL": "http://p",
            "WIZARR_URL": "http://w",
            "MEDIA_ROOTS": "/Meleys",
            "PROBE_TIMEOUT_SECONDS": "30",
        }
    )
    reg = Registry.from_env(
        {
            "SONARR_MELEYS_URL": "http://m:1",
            "SONARR_MELEYS_API_KEY": "k",
            "SONARR_VERMITHOR_URL": "http://v:1",
            "SONARR_VERMITHOR_API_KEY": "k",
            "TAUTULLI_VERMITHOR_URL": "http://v:2",
            "TAUTULLI_VERMITHOR_API_KEY": "k",
        }
    )
    services = build_services(cfg, reg)
    assert (
        set(services.sonarr) == {"meleys", "vermithor"}
        and services.sonarr["meleys"].host == "meleys"
    )
    assert set(services.tautulli) == {"vermithor"} and services.radarr == {}
    assert services.seerr.base_url == "http://s"
    assert services.probe.paths.roots == ("/Meleys",) and services.probe.timeout == 30
    assert services.fleet is None and services.speedtest is None  # neither set up
    tester = build_services(load_settings({"SPEEDTEST_HOST": "meleys"}), reg).speedtest
    assert tester.host == "meleys"


def test_build_services_reads_the_fleet_monitor_when_it_is_set_up():
    cfg = load_settings({"FLEET_MONITOR_URL": "http://m:8010", "FLEET_MONITOR_TOKEN": "tok"})
    fleet = build_services(cfg, Registry()).fleet
    assert fleet.base_url == "http://m:8010"
    assert fleet.client.headers["Authorization"] == "Bearer tok"


def test_boot_refuses_an_old_variable_name_before_anything_else(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)  # no `.env` here to read
    monkeypatch.setenv("MAESTER_DB_PATH", "/data/maester.db")
    # Required variables are missing too; the rename is reported first.
    with pytest.raises(RenamedConfig, match="MAESTER_DB_PATH is now LUWIN_DB_PATH"):
        run()


async def test_notices_go_to_the_log_until_luwin_has_an_app(caplog):
    caplog.set_level(logging.INFO, logger="luwin.notify")
    assert await LogNotifier().deliver([AdminPost("Dune is ready")]) == []
    assert "Dune is ready" in caplog.text
