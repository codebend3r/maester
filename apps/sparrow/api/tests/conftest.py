import json
from pathlib import Path

import pytest

from sparrow.agent.tools import Tier, ToolContext
from sparrow.clients import (
    FakeFileProbe,
    FakeFleetMonitor,
    FakeRadarrClient,
    FakeRavenClient,
    FakeSabnzbdClient,
    FakeSeerrClient,
    FakeSonarrClient,
    FakeSpeedTest,
    Services,
)
from sparrow.config import Settings
from sparrow.memo import Memo
from sparrow.store import Store
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
        raven=FakeRavenClient(),
        sonarr={h: FakeSonarrClient(host=h, base_url=SONARR_URL.format(host=h)) for h in HOSTS},
        radarr={h: FakeRadarrClient(host=h, base_url=RADARR_URL.format(host=h)) for h in HOSTS},
        sabnzbd={h: FakeSabnzbdClient(host=h) for h in HOSTS},
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
    store.upsert_user("d1", seerr_user_id=4, email="dany@example.com", raven_status="approved")
    return ToolContext("d1", Tier.FRIEND, services, store, Settings(), Memo())
