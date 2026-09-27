"""Thin async clients for every service maester talks to, each with a fake.

A client does one thing: turn a method call into an HTTP request and the
response into a typed record. No retries beyond httpx defaults, no caching,
no policy; that lives in the tools. Every client has a `Fake*` sibling with
the same methods over in-memory data, so tools and evals run without a stack.
`Services` is the bag of clients the app hands every tool, real or fake;
`probe` reads the media files themselves, with ffprobe on the read-only mount.
"""

from dataclasses import dataclass

from maester.clients.base import ClientError, HttpClient
from maester.clients.media import FakeFileProbe, FileProbe, MediaProbe
from maester.clients.plex import FakePlexClient, Plex, PlexClient
from maester.clients.radarr import FakeRadarrClient, Radarr, RadarrClient
from maester.clients.sabnzbd import FakeSabnzbdClient, Sabnzbd, SabnzbdClient
from maester.clients.seerr import FakeSeerrClient, Seerr, SeerrClient
from maester.clients.sonarr import FakeSonarrClient, Sonarr, SonarrClient
from maester.clients.tautulli import FakeTautulliClient, Tautulli, TautulliClient
from maester.clients.wizarr import FakeWizarrClient, Wizarr, WizarrClient


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


__all__ = [
    "ClientError",
    "FakeFileProbe",
    "FakePlexClient",
    "FakeRadarrClient",
    "FakeSabnzbdClient",
    "FakeSeerrClient",
    "FakeSonarrClient",
    "FakeTautulliClient",
    "FakeWizarrClient",
    "FileProbe",
    "HttpClient",
    "PlexClient",
    "RadarrClient",
    "SabnzbdClient",
    "SeerrClient",
    "Services",
    "SonarrClient",
    "TautulliClient",
    "WizarrClient",
]
