"""Builds the fake service bag and the tool registry an eval case runs in.

Every tool module registers into the process-wide registry, and the case's
seed (plain dicts) is turned into the fakes' records. One `seerr.results`
entry describes a title once: it is both what search finds and what the
details lookup returns. The eval user is linked (to Tautulli too, when the
case gives `user.tautulli_user_id`), so tools act as a real friend's would;
their Tautulli sessions are seeded per host, and the files the health check
reads under `probe`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from maester.agent.tools import ToolRegistry
from maester.agent.tools import registry as app_registry
from maester.clients import (
    FakeFileProbe,
    FakeFleetMonitor,
    FakePlexClient,
    FakeRadarrClient,
    FakeSabnzbdClient,
    FakeSeerrClient,
    FakeSonarrClient,
    FakeTautulliClient,
    FakeWizarrClient,
    Services,
)
from maester.clients.arr import MediaFile, QueueItem
from maester.clients.fleet import Vitals
from maester.clients.media import Inspection, Track
from maester.clients.plex import PlexItem, PlexSeason, Version
from maester.clients.radarr import Movie
from maester.clients.seerr import (
    ArrServer,
    Collection,
    MediaDetails,
    MediaRequest,
    MediaStatus,
    RequestStatus,
    SearchResult,
    Season,
    SeerrUser,
)
from maester.clients.sonarr import Episode, Series
from maester.clients.tautulli import Session
from maester.store import Store

# Importing the tools package registers every tool module into app_registry.
import maester.tools  # noqa: F401  isort: skip

EVAL_USER = "eval-user"
ARR_URLS = {"radarr": "http://{host}.lan:7878", "sonarr": "http://{host}.lan:8989"}


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
        media_id=r.get("media_id"),
        runtime_minutes=r.get("runtime"),
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


def _request(n: int, r: dict[str, Any], seerr_user_id: int) -> MediaRequest:
    approved = r.get("status", "approved") == "approved"
    return MediaRequest(
        id=n,
        status=RequestStatus.APPROVED if approved else RequestStatus.PENDING,
        media_type=r.get("media_type", "movie"),
        tmdb_id=int(r["tmdb_id"]),
        is_4k=bool(r.get("is_4k", False)),
        requested_by_id=seerr_user_id,
        media_status=MediaStatus.PROCESSING if approved else MediaStatus.PENDING,
    )


def _seerr(seed: dict[str, Any], seerr_user_id: int, hosts: list[str]) -> FakeSeerrClient:
    titles = [_title(r) for r in seed.get("results", [])]
    # Seerr's 4K servers, when the case has them, point at the last host's arrs.
    uhd_host = hosts[-1]
    four_k = {
        kind: [ArrServer(9, f"{kind} 4K", True, True, ARR_URLS[kind].format(host=uhd_host))]
        for kind in ("radarr", "sonarr")
    }
    by_id = {result.tmdb_id: result for result, _ in titles}
    return FakeSeerrClient(
        results=[result for result, _ in titles],
        details={(d.media_type, d.tmdb_id): d for _, d in titles},
        collections={
            int(c["id"]): Collection(int(c["id"]), c["name"], tuple(by_id[t] for t in c["parts"]))
            for c in seed.get("collections", [])
        },
        user_list=[
            SeerrUser(
                int(u["id"]), u.get("email", ""), u.get("username", ""), u.get("plex_username", "")
            )
            for u in seed.get("users", [])
        ],
        requests=[_request(n, r, seerr_user_id) for n, r in enumerate(seed.get("requests", []), 1)],
        arr_servers=four_k if seed.get("four_k") else {},
        auto_approve=bool(seed.get("auto_approve", False)),
    )


def _file(f: dict[str, Any], media_id: int) -> MediaFile:
    """A movie or episode file; sizes in GB, `audio` in Sonarr's "jpn/eng" form."""
    return MediaFile(
        id=int(f["id"]),
        path=f.get("path", ""),
        size_bytes=int(f.get("size_gb", 1) * 1e9),
        quality=f.get("quality", "WEBDL-1080p"),
        release_group=f.get("release_group"),
        media_id=media_id,
        season=f.get("season"),
        audio_languages=tuple(f["audio"].split("/")) if "audio" in f else None,
    )


def _radarr(host: str, seed: dict[str, Any]) -> FakeRadarrClient:
    """A host's movies, their files and what is downloading for them; sizes in GB."""
    return FakeRadarrClient(
        host=host,
        base_url=ARR_URLS["radarr"].format(host=host),
        files=[_file(f, int(f["movie_id"])) for f in seed.get("files", [])],
        movie_list=[
            Movie(int(m["id"]), m["title"], int(m["tmdb_id"]), m.get("year"), "", True, False, None)
            for m in seed.get("movies", [])
        ],
        queue_items=[
            QueueItem(
                id=n,
                title=q.get("title", ""),
                status=q.get("status", "downloading"),
                size_bytes=int(q["size_gb"] * 1e9),
                size_left_bytes=int(q["left_gb"] * 1e9),
                time_left=q.get("time_left"),
                error_messages=tuple(q.get("messages", [])),
                download_id=q.get("download_id"),
                media_id=int(q["movie_id"]),
                tracked_status=q.get("tracked_status", "ok"),
            )
            for n, q in enumerate(seed.get("queue", []), 1)
        ],
    )


def _plex(seed: dict[str, Any]) -> FakePlexClient:
    items = {
        str(i["rating_key"]): PlexItem(
            rating_key=str(i["rating_key"]),
            title=i["title"],
            type=i.get("type", "movie"),
            year=i.get("year"),
            guids=(f"tmdb://{i['tmdb_id']}",) if "tmdb_id" in i else (),
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


def _sonarr(host: str, seed: dict[str, Any]) -> FakeSonarrClient:
    """A host's shows and their episode files; `audio` is Sonarr's "jpn/eng" form."""
    return FakeSonarrClient(
        host=host,
        base_url=ARR_URLS["sonarr"].format(host=host),
        series_list=[
            Series(
                id=int(x["id"]),
                title=x["title"],
                tvdb_id=int(x["tvdb_id"]),
                year=x.get("year"),
                path="",
                monitored=True,
                series_type=x.get("type", "standard"),
                season_numbers=tuple(x.get("seasons", [])),
            )
            for x in seed.get("series", [])
        ],
        files=[
            _file({"id": n, **f}, int(f["series_id"]))
            for n, f in enumerate(seed.get("files", []), 1)
        ],
        episode_list=[
            Episode(
                id=int(e["id"]),
                series_id=int(e["series_id"]),
                season=int(e["season"]),
                number=int(e["number"]),
                title=e.get("title", ""),
                has_file="file_id" in e,
                file_id=e.get("file_id"),
                monitored=e.get("monitored", True),
                aired=datetime.fromisoformat(e["aired"]) if "aired" in e else None,
            )
            for e in seed.get("episodes", [])
        ],
    )


def _session(n: int, x: dict[str, Any], user_id: int) -> Session:
    """One of the eval user's live sessions; unset fields read as a direct-played 1080p file."""
    direct = "direct play"
    return Session(
        session_key=str(n),
        user_id=user_id,
        user="eval",
        rating_key=str(x["rating_key"]),
        full_title=x["title"],
        media_type="episode" if "show_key" in x else "movie",
        state="playing",
        progress_percent=10,
        platform=x.get("platform", "Roku"),
        player=x.get("player", "Living Room"),
        product=x.get("product", "Plex for Roku"),
        location="lan",
        relayed=False,
        secure=True,
        bandwidth_kbps=20000,
        stream_bitrate_kbps=20000,
        transcode_decision=x.get("transcode_decision", direct),
        video_decision=x.get("video_decision", direct),
        audio_decision=x.get("audio_decision", direct),
        subtitle_decision=x.get("subtitle_decision", ""),
        container="mkv",
        video_codec=x.get("video_codec", "h264"),
        video_resolution="1080",
        video_dynamic_range="SDR",
        audio_codec=x.get("audio_codec", "eac3"),
        audio_channels=6,
        subtitle_codec=x.get("subtitle_codec", ""),
        quality_profile="Original",
        file="",
        show_key=str(x.get("show_key", "")),
        season=x.get("season"),
        episode=x.get("episode"),
        dovi_profile=int(x.get("dovi_profile", 0)),
    )


def _tautulli(host: str, seed: dict[str, Any], user_id: int) -> FakeTautulliClient:
    sessions = [_session(n, x, user_id) for n, x in enumerate(seed.get("sessions", []), 1)]
    return FakeTautulliClient(host=host, sessions=sessions)


def _probe(seed: dict[str, Any]) -> FakeFileProbe:
    """Files as ffprobe reads them, by path, and what decoding each prints."""
    return FakeFileProbe(
        files={
            path: Inspection(
                path=path,
                duration=float(f.get("duration", 3600)),
                video_codec=f.get("video_codec", "h264"),
                dovi_profile=int(f.get("dovi_profile", 0)),
                tracks=tuple(
                    Track(
                        kind=t["kind"],
                        codec=t["codec"],
                        language=t.get("language", ""),
                        title=t.get("title", ""),
                        forced=t.get("forced", False),
                        channels=t.get("channels", 0),
                    )
                    for t in f.get("tracks", [])
                ),
            )
            for path, f in seed.get("files", {}).items()
        },
        errors={path: tuple(lines) for path, lines in seed.get("errors", {}).items()},
    )


def _fleet(seed: dict[str, Any]) -> FakeFleetMonitor:
    """Each NAS's CPU and memory, in percent, as the fleet monitor reads them."""
    return FakeFleetMonitor(
        {host: Vitals(v.get("cpu"), v.get("memory")) for host, v in seed.items()}
    )


def build_services(seed: dict[str, Any], seerr_user_id: int = 4) -> Services:
    hosts = seed.get("hosts", ["meleys", "vermithor"])
    radarr, sonarr = seed.get("radarr", {}), seed.get("sonarr", {})
    tautulli, tautulli_user = seed.get("tautulli", {}), _tautulli_user(seed)
    return Services(
        seerr=_seerr(seed.get("seerr", {}), seerr_user_id, hosts),
        plex=_plex(seed.get("plex", {})),
        wizarr=FakeWizarrClient(),
        sonarr={h: _sonarr(h, sonarr.get(h, {})) for h in hosts},
        radarr={h: _radarr(h, radarr.get(h, {})) for h in hosts},
        sabnzbd={h: FakeSabnzbdClient(host=h) for h in hosts},
        tautulli={h: _tautulli(h, tautulli.get(h, {}), tautulli_user or 0) for h in hosts},
        probe=_probe(seed.get("probe", {})),
        fleet=_fleet(seed["fleet"]) if "fleet" in seed else None,
    )


def _tautulli_user(seed: dict[str, Any]) -> int | None:
    user_id = seed.get("user", {}).get("tautulli_user_id")
    return int(user_id) if user_id is not None else None


def build_world(seed: dict[str, Any]) -> tuple[ToolRegistry, Services, Store]:
    store = Store(":memory:")
    user = seed.get("user", {})
    seerr_user_id = int(user.get("seerr_user_id", 4))
    store.upsert_user(
        EVAL_USER,
        status="active",
        seerr_user_id=seerr_user_id,
        tautulli_user_id=_tautulli_user(seed),
        plex_username=user.get("plex_username", "eval"),
    )
    return app_registry, build_services(seed, seerr_user_id), store
