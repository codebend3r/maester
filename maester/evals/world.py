"""Builds the fake service bag and the tool registry an eval case runs in.

Tool modules register into the process-wide registry as they land (E3+);
until then the world exposes the fakes plus whatever tools are registered.
Seeds in the case file are plain dicts turned into the fakes' records.
"""

from __future__ import annotations

from typing import Any

from maester.agent.tools import ToolRegistry
from maester.agent.tools import registry as app_registry
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
from maester.clients.seerr import SearchResult, SeerrUser
from maester.store import Store


def build_services(seed: dict[str, Any]) -> Services:
    seerr = FakeSeerrClient(
        results=[
            SearchResult(
                tmdb_id=int(r["tmdb_id"]),
                media_type=r.get("media_type", "movie"),
                title=r["title"],
                year=r.get("year"),
                overview=r.get("overview", ""),
                poster_path=r.get("poster_path"),
                status=int(r.get("status", 1)),
                status_4k=int(r.get("status_4k", 1)),
            )
            for r in seed.get("seerr", {}).get("results", [])
        ],
        user_list=[
            SeerrUser(
                int(u["id"]), u.get("email", ""), u.get("username", ""), u.get("plex_username", "")
            )
            for u in seed.get("seerr", {}).get("users", [])
        ],
        auto_approve=bool(seed.get("seerr", {}).get("auto_approve", False)),
    )
    hosts = seed.get("hosts", ["meleys", "vermithor"])
    return Services(
        seerr=seerr,
        plex=FakePlexClient(),
        wizarr=FakeWizarrClient(),
        sonarr={h: FakeSonarrClient(host=h) for h in hosts},
        radarr={h: FakeRadarrClient(host=h) for h in hosts},
        sabnzbd={h: FakeSabnzbdClient(host=h) for h in hosts},
        tautulli={h: FakeTautulliClient(host=h) for h in hosts},
    )


def build_world(seed: dict[str, Any]) -> tuple[ToolRegistry, Services, Store]:
    return app_registry, build_services(seed), Store(":memory:")
