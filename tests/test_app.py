from types import SimpleNamespace

from fastapi.testclient import TestClient

from maester.agent.tools import ToolRegistry
from maester.app import build, build_services
from maester.config import load_settings
from maester.registry import Registry
from maester.store import Store


def test_build_wires_everything_with_injected_pieces():
    cfg = load_settings({"DISCORD_GUILD_ID": "1", "DISCORD_ROLE_ADMIN": "9"})
    store = Store(":memory:")
    app = build(
        cfg, services=SimpleNamespace(), model_client=object(), tools=ToolRegistry(), store=store
    )
    assert app.agent.model == "claude-opus-5-5" and app.agent.effort == "medium"
    assert app.bot.guild_id == 1 and app.chat.identity.roles.admin_role_id == 9
    assert app.web.title == "maester"
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
    assert services.fleet is None  # no fleet monitor set up


def test_build_services_reads_the_fleet_monitor_when_it_is_set_up():
    cfg = load_settings(
        {
            "FLEET_MONITOR_URL": "http://m:8010",
            "FLEET_MONITOR_SUPABASE_URL": "https://p.supabase.co",
            "FLEET_MONITOR_SUPABASE_KEY": "anon",
            "FLEET_MONITOR_EMAIL": "maester@example.com",
            "FLEET_MONITOR_PASSWORD": "pw",
        }
    )
    fleet = build_services(cfg, Registry()).fleet
    assert fleet.base_url == "http://m:8010" and fleet.session.base_url == "https://p.supabase.co"
