"""Thin async clients for every service luwin talks to, each with a fake.

A client does one thing: turn a method call into an HTTP request and the
response into a typed record. No retries beyond httpx defaults, no caching,
no policy; that lives in the tools. Every client has a `Fake*` sibling with
the same methods over in-memory data, so tools and evals run without a stack.
`Services` is the bag of clients the app hands every tool, real or fake;
`probe` reads the media files themselves, with ffprobe on the read-only mount.
`speedtest` measures the internet connection from the container's own host.
`plextv` reads and changes friends' library shares as the server owner.
The fleet monitor, the speed test and plex.tv are optional: None where not set up.
"""

from dataclasses import dataclass

from luwin.clients.base import ClientError, HttpClient
from luwin.clients.fleet import FakeFleetMonitor, FleetMonitor, FleetMonitorClient
from luwin.clients.media import FakeFileProbe, FileProbe, MediaProbe
from luwin.clients.plex import FakePlexClient, Plex, PlexClient
from luwin.clients.plextv import FakePlexTv, PlexTv, PlexTvClient
from luwin.clients.radarr import FakeRadarrClient, Radarr, RadarrClient
from luwin.clients.sabnzbd import FakeSabnzbdClient, Sabnzbd, SabnzbdClient
from luwin.clients.seerr import FakeSeerrClient, Seerr, SeerrClient
from luwin.clients.sonarr import FakeSonarrClient, Sonarr, SonarrClient
from luwin.clients.speedtest import FakeSpeedTest, OoklaSpeedTest, SpeedTester
from luwin.clients.tautulli import FakeTautulliClient, Tautulli, TautulliClient
from luwin.clients.wizarr import FakeWizarrClient, Wizarr, WizarrClient


@dataclass
class Services:
    """One client per single-instance service, one per host for the rest."""

    seerr: Seerr
    plex: Plex
    wizarr: Wizarr
    sonarr: dict[str, Sonarr]
    radarr: dict[str, Radarr]
    sabnzbd: dict[str, Sabnzbd]
    tautulli: dict[str, Tautulli]
    probe: MediaProbe
    fleet: FleetMonitor | None  # CPU and memory per NAS; None when not set up
    speedtest: SpeedTester | None  # None when SPEEDTEST_HOST isn't set
    plextv: PlexTv | None = None  # None without the owner's PLEX_TOKEN


__all__ = [
    "ClientError",
    "FakeFileProbe",
    "FakeFleetMonitor",
    "FakePlexClient",
    "FakePlexTv",
    "FakeRadarrClient",
    "FakeSabnzbdClient",
    "FakeSeerrClient",
    "FakeSonarrClient",
    "FakeSpeedTest",
    "FakeTautulliClient",
    "FakeWizarrClient",
    "FileProbe",
    "FleetMonitorClient",
    "HttpClient",
    "OoklaSpeedTest",
    "PlexClient",
    "PlexTvClient",
    "RadarrClient",
    "SabnzbdClient",
    "SeerrClient",
    "Services",
    "SonarrClient",
    "TautulliClient",
    "WizarrClient",
]
