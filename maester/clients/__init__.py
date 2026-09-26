"""Thin async clients for every service maester talks to, each with a fake.

A client does one thing: turn a method call into an HTTP request and the
response into a typed record. No retries beyond httpx defaults, no caching,
no policy; that lives in the tools. Every client has a `Fake*` sibling with
the same methods over in-memory data, so tools and evals run without a stack.
"""

from maester.clients.base import ClientError, HttpClient
from maester.clients.plex import FakePlexClient, PlexClient
from maester.clients.radarr import FakeRadarrClient, RadarrClient
from maester.clients.sabnzbd import FakeSabnzbdClient, SabnzbdClient
from maester.clients.seerr import FakeSeerrClient, SeerrClient
from maester.clients.sonarr import FakeSonarrClient, SonarrClient
from maester.clients.tautulli import FakeTautulliClient, TautulliClient
from maester.clients.wizarr import FakeWizarrClient, WizarrClient

__all__ = [
    "ClientError",
    "FakePlexClient",
    "FakeRadarrClient",
    "FakeSabnzbdClient",
    "FakeSeerrClient",
    "FakeSonarrClient",
    "FakeTautulliClient",
    "FakeWizarrClient",
    "HttpClient",
    "PlexClient",
    "RadarrClient",
    "SabnzbdClient",
    "SeerrClient",
    "SonarrClient",
    "TautulliClient",
    "WizarrClient",
]
