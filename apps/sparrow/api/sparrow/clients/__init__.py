"""Thin async clients for every service sparrow talks to, each with a fake.

A client does one thing: turn a method call into an HTTP request and the
response into a typed record. No retries beyond httpx defaults, no caching,
no policy; that lives in the tools. Every client has a `Fake*` sibling with
the same methods over in-memory data, so tools and evals run without a stack.
`Services` is the bag of clients the app hands every tool, real or fake;
`probe` reads the media files themselves, with ffprobe on the read-only mount.
`speedtest` measures the internet connection from the container's own host.
`raven` is the suite's own library and player, and its sign-in: it says who
a token is, and tools read it as the person asking (`ToolContext.raven`).
`arr_libraries` is each Radarr, Sonarr and Lidarr as a whole, by service and host,
for the admin's questions about them and the moves they ask for.
The fleet monitor and the speed test are optional: None where not set up.
"""

from dataclasses import dataclass, field

from sparrow.clients.arr_library import ArrLibrary, ArrService
from sparrow.clients.base import ClientError, HttpClient
from sparrow.clients.fleet import FakeFleetMonitor, FleetMonitor, FleetMonitorClient
from sparrow.clients.media import FakeFileProbe, FileProbe, MediaProbe
from sparrow.clients.radarr import FakeRadarrClient, Radarr, RadarrClient
from sparrow.clients.raven import FakeRavenClient, RavenClient, RavenServer
from sparrow.clients.sabnzbd import FakeSabnzbdClient, Sabnzbd, SabnzbdClient
from sparrow.clients.seerr import FakeSeerrClient, Seerr, SeerrClient
from sparrow.clients.sonarr import FakeSonarrClient, Sonarr, SonarrClient
from sparrow.clients.speedtest import FakeSpeedTest, OoklaSpeedTest, SpeedTester


@dataclass
class Services:
    """One client per single-instance service, one per host for the rest."""

    seerr: Seerr
    raven: RavenServer
    sonarr: dict[str, Sonarr]
    radarr: dict[str, Radarr]
    sabnzbd: dict[str, Sabnzbd]
    probe: MediaProbe
    fleet: FleetMonitor | None  # CPU and memory per NAS; None when not set up
    speedtest: SpeedTester | None  # None when SPEEDTEST_HOST isn't set
    # Every Radarr, Sonarr and Lidarr, by service, then host.
    arr_libraries: dict[ArrService, dict[str, ArrLibrary]] = field(default_factory=dict)


__all__ = [
    "ClientError",
    "FakeFileProbe",
    "FakeFleetMonitor",
    "FakeRadarrClient",
    "FakeRavenClient",
    "FakeSabnzbdClient",
    "FakeSeerrClient",
    "FakeSonarrClient",
    "FakeSpeedTest",
    "FileProbe",
    "FleetMonitorClient",
    "HttpClient",
    "OoklaSpeedTest",
    "RadarrClient",
    "RavenClient",
    "SabnzbdClient",
    "SeerrClient",
    "Services",
    "SonarrClient",
]
