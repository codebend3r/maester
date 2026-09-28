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
    cfg = load_settings({"SEERR_URL": "http://s", "PLEX_URL": "http://p", "WIZARR_URL": "http://w"})
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
