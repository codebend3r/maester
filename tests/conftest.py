import json
from pathlib import Path

import pytest

from maester.agent.tools import Tier, ToolContext
from maester.clients import (
    FakePlexClient,
    FakeRadarrClient,
    FakeSabnzbdClient,
    FakeSeerrClient,
    FakeSonarrClient,
    FakeTautulliClient,
    FakeWizarrClient,
    Services,
)
from maester.store import Store

FIXTURES = Path(__file__).parent / "fixtures"
HOSTS = ("meleys", "vermithor")


@pytest.fixture
def fixture():
    def load(name: str):
        return json.loads((FIXTURES / f"{name}.json").read_text())

    return load


@pytest.fixture
def services() -> Services:
    """Every service faked, with the two real hosts' per-host clients empty."""
    return Services(
        seerr=FakeSeerrClient(),
        plex=FakePlexClient(),
        wizarr=FakeWizarrClient(),
        sonarr={h: FakeSonarrClient(host=h) for h in HOSTS},
        radarr={h: FakeRadarrClient(host=h) for h in HOSTS},
        sabnzbd={h: FakeSabnzbdClient(host=h) for h in HOSTS},
        tautulli={h: FakeTautulliClient(host=h) for h in HOSTS},
    )


@pytest.fixture
def store():
    s = Store(":memory:")
    yield s
    s.close()


@pytest.fixture
def ctx(services, store) -> ToolContext:
    """A linked friend (Seerr user 4) calling tools."""
    store.upsert_user("d1", status="active", seerr_user_id=4, plex_username="dany")
    return ToolContext(user_id="d1", tier=Tier.FRIEND, services=services, store=store)
