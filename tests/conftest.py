import json
from pathlib import Path

import pytest

from maester.agent.tools import Tier, ToolContext
from maester.clients import (
    FakeFileProbe,
    FakeFleetMonitor,
    FakePlexClient,
    FakeRadarrClient,
    FakeSabnzbdClient,
    FakeSeerrClient,
    FakeSonarrClient,
    FakeSpeedTest,
    FakeTautulliClient,
    FakeWizarrClient,
    Services,
)
from maester.config import Settings
from maester.memo import Memo
from maester.store import Store
from tests.factories import HOSTS, RADARR_URL, SONARR_URL

FIXTURES = Path(__file__).parent / "fixtures"


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
        # maester reads vermithor's Plex server, which vermithor's Tautulli watches.
        plex=FakePlexClient(base_url="http://vermithor.lan:32400"),
        wizarr=FakeWizarrClient(),
        sonarr={h: FakeSonarrClient(host=h, base_url=SONARR_URL.format(host=h)) for h in HOSTS},
        radarr={h: FakeRadarrClient(host=h, base_url=RADARR_URL.format(host=h)) for h in HOSTS},
        sabnzbd={h: FakeSabnzbdClient(host=h) for h in HOSTS},
        tautulli={h: FakeTautulliClient(host=h, base_url=f"http://{h}.lan:8181") for h in HOSTS},
        probe=FakeFileProbe(),
        fleet=FakeFleetMonitor(),
        speedtest=FakeSpeedTest(),
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
    return ToolContext("d1", Tier.FRIEND, services, store, Settings(), Memo())
