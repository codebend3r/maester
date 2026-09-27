"""Builds the fake service bag and the tool registry an eval case runs in.

Every tool module registers into the process-wide registry, and the case's
seed (plain dicts) is turned into the fakes' records. One `seerr.results`
entry describes a title once: it is both what search finds and what the
details lookup returns. The eval user is linked, so request tools act as a
real friend would.
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
from maester.clients.plex import PlexItem, PlexSeason, Version
from maester.clients.seerr import (
    ArrServer,
    MediaDetails,
    MediaStatus,
    SearchResult,
    Season,
    SeerrUser,
    ServerOptions,
)
from maester.store import Store

# Importing the tools package registers every tool module into app_registry.
import maester.tools  # noqa: F401  isort: skip

EVAL_USER = "eval-user"


def _title(r: dict[str, Any]) -> tuple[SearchResult, MediaDetails]:
    media_type = r.get("media_type", "movie")
    status = MediaStatus(int(r.get("status", MediaStatus.UNKNOWN)))
    status_4k = MediaStatus(int(r.get("status_4k", MediaStatus.UNKNOWN)))
    result = SearchResult(
        tmdb_id=int(r["tmdb_id"]),
        media_type=media_type,
        title=r["title"],
        year=r.get("year"),
        overview=r.get("overview", ""),
        poster_path=r.get("poster_path"),
        status=status,
        status_4k=status_4k,
    )
    details = MediaDetails(
        tmdb_id=result.tmdb_id,
        media_type=media_type,
        title=result.title,
        year=result.year,
        overview=result.overview,
        status=status,
        status_4k=status_4k,
        rating_key=r.get("rating_key"),
        tvdb_id=r.get("tvdb_id"),
        collection_id=r.get("collection_id"),
        seasons=tuple(
            Season(
                int(s["number"]),
                int(s["episodes"]),
                MediaStatus(int(s.get("status", MediaStatus.UNKNOWN))),
                MediaStatus.UNKNOWN,
            )
            for s in r.get("seasons", [])
        ),
        keyword_ids=frozenset(r.get("keywords", [])),
        genre_ids=frozenset(r.get("genres", [])),
        original_language=r.get("original_language", ""),
    )
    return result, details


def _seerr(seed: dict[str, Any]) -> FakeSeerrClient:
    titles = [_title(r) for r in seed.get("results", [])]
    four_k = [
        ServerOptions(ArrServer(9, f"{kind} 4K", is_4k=True, is_default=True), (), ())
        for kind in ("radarr", "sonarr")
    ]
    return FakeSeerrClient(
        results=[result for result, _ in titles],
        details={(d.media_type, d.tmdb_id): d for _, d in titles},
        user_list=[
            SeerrUser(
                int(u["id"]), u.get("email", ""), u.get("username", ""), u.get("plex_username", "")
            )
            for u in seed.get("users", [])
        ],
        server_list={"radarr": [four_k[0]], "sonarr": [four_k[1]]} if seed.get("four_k") else {},
        auto_approve=bool(seed.get("auto_approve", False)),
    )


def _plex(seed: dict[str, Any]) -> FakePlexClient:
    items = {
        str(i["rating_key"]): PlexItem(
            rating_key=str(i["rating_key"]),
            title=i["title"],
            type=i.get("type", "movie"),
            year=i.get("year"),
            guids=(),
            versions=tuple(
                Version(
                    resolution=str(v["resolution"]),
                    video_codec=v.get("codec", "h264"),
                    bitrate_kbps=int(v.get("bitrate_mbps", 10) * 1000),
                    size_bytes=int(v.get("size_gb", 10) * 1e9),
                    file=v.get("file", ""),
                )
                for v in i.get("versions", [])
            ),
        )
        for i in seed.get("items", [])
    }
    seasons = {
        str(key): [PlexSeason(int(s["number"]), int(s["episodes"])) for s in rows]
        for key, rows in seed.get("seasons", {}).items()
    }
    return FakePlexClient(items=items, show_seasons=seasons)


def build_services(seed: dict[str, Any]) -> Services:
    hosts = seed.get("hosts", ["meleys", "vermithor"])
    return Services(
        seerr=_seerr(seed.get("seerr", {})),
        plex=_plex(seed.get("plex", {})),
        wizarr=FakeWizarrClient(),
        sonarr={h: FakeSonarrClient(host=h) for h in hosts},
        radarr={h: FakeRadarrClient(host=h) for h in hosts},
        sabnzbd={h: FakeSabnzbdClient(host=h) for h in hosts},
        tautulli={h: FakeTautulliClient(host=h) for h in hosts},
    )


def build_world(seed: dict[str, Any]) -> tuple[ToolRegistry, Services, Store]:
    store = Store(":memory:")
    user = seed.get("user", {})
    store.upsert_user(
        EVAL_USER,
        status="active",
        seerr_user_id=int(user.get("seerr_user_id", 4)),
        plex_username=user.get("plex_username", "eval"),
    )
    return app_registry, build_services(seed), store
