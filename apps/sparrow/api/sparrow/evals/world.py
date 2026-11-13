"""Builds the fake service bag and the tool registry an eval case runs in.

Every tool module registers into the process-wide registry, and the case's
seed (`sparrow/evals/seed.py`, checked when the case loads) is turned into
the fakes' records. One `seerr.results`
entry describes a title once: it is both what search finds and what the
details lookup returns. The eval user is linked (to Tautulli too, when the
case gives `user.tautulli_user_id`), so tools act as a real friend's would;
their Tautulli sessions are seeded per host, and the files the health check
reads under `probe`.
"""

from __future__ import annotations

import time
from datetime import datetime

from sparrow.agent.tools import ToolRegistry
from sparrow.agent.tools import registry as app_registry
from sparrow.clients import (
    FakeFileProbe,
    FakeFleetMonitor,
    FakePlexClient,
    FakeRadarrClient,
    FakeRavenClient,
    FakeSabnzbdClient,
    FakeSeerrClient,
    FakeSonarrClient,
    FakeSpeedTest,
    FakeTautulliClient,
    FakeWizarrClient,
    Services,
)
from sparrow.clients.arr import HistoryEvent, MediaFile, QueueItem, RootFolder
from sparrow.clients.arr_library import ArrService, CustomFilter, FakeArrLibrary
from sparrow.clients.fleet import Vitals
from sparrow.clients.media import Inspection, Track
from sparrow.clients.plex import PlexItem, PlexSeason, Version
from sparrow.clients.plextv import FakePlexTv
from sparrow.clients.radarr import Movie
from sparrow.clients.raven import Part, RavenPerson, RavenTitle, Work
from sparrow.clients.sabnzbd import Download
from sparrow.clients.seerr import (
    ArrRef,
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
from sparrow.clients.sonarr import Episode, Series
from sparrow.clients.speedtest import SpeedResult
from sparrow.clients.tautulli import HistoryRow, Session
from sparrow.evals.seed import (
    ArrLibrarySeed,
    HistoryEventSeed,
    PlayedSeed,
    PlexSeed,
    ProbeSeed,
    RadarrFileSeed,
    RadarrSeed,
    RavenSeed,
    RequestSeed,
    SabnzbdSeed,
    Seed,
    SeerrSeed,
    SessionSeed,
    SonarrFileSeed,
    SonarrSeed,
    SpeedSeed,
    TautulliSeed,
    TitleSeed,
    VitalsSeed,
)
from sparrow.store import Store

# Importing the tools package registers every tool module into app_registry.
import sparrow.tools  # noqa: F401  isort: skip

EVAL_USER = "eval-user"
# The Plex server sparrow reads (`PLEX_URL`): the first host's, watched by its Tautulli.
PLEX_ID = "library-plex"
UHD_SERVER_ID = 9  # Seerr's id for the 4K Radarr and Sonarr a `four_k` case lists
ARR_URLS = {"radarr": "http://{host}.lan:7878", "sonarr": "http://{host}.lan:8989"}
GB = 1e9


def _title(r: TitleSeed) -> tuple[SearchResult, MediaDetails]:
    result = SearchResult(
        tmdb_id=r.tmdb_id,
        media_type=r.media_type,
        title=r.title,
        year=r.year,
        overview=r.overview,
        poster_path=r.poster_path,
        status=r.status,
        status_4k=r.status_4k,
    )
    details = MediaDetails(
        tmdb_id=r.tmdb_id,
        media_type=r.media_type,
        title=r.title,
        year=r.year,
        overview=r.overview,
        status=r.status,
        status_4k=r.status_4k,
        rating_key=r.rating_key,
        rating_key_4k=r.rating_key_4k,
        arr_4k=ArrRef(UHD_SERVER_ID, r.arr_4k) if r.arr_4k is not None else None,
        media_id=r.media_id,
        runtime_minutes=r.runtime,
        tvdb_id=r.tvdb_id,
        collection_id=r.collection_id,
        seasons=tuple(
            Season(s.number, s.episodes, s.status, MediaStatus.UNKNOWN) for s in r.seasons
        ),
        keyword_ids=frozenset(r.keywords),
        genre_ids=frozenset(r.genres),
        original_language=r.original_language,
    )
    return result, details


def _request(n: int, r: RequestSeed, seerr_user_id: int) -> MediaRequest:
    is_approved = r.status == "approved"
    return MediaRequest(
        id=n,
        status=RequestStatus.APPROVED if is_approved else RequestStatus.PENDING,
        media_type=r.media_type,
        tmdb_id=r.tmdb_id,
        is_4k=r.is_4k,
        requested_by_id=seerr_user_id,
        media_status=MediaStatus.PROCESSING if is_approved else MediaStatus.PENDING,
    )


def _seerr(seed: SeerrSeed, seerr_user_id: int, hosts: list[str]) -> FakeSeerrClient:
    titles = [_title(r) for r in seed.results]
    # Seerr's 4K servers, when the case has them, point at the last host's arrs.
    uhd_host = hosts[-1]
    four_k = {
        kind: [
            ArrServer(UHD_SERVER_ID, f"{kind} 4K", True, True, ARR_URLS[kind].format(host=uhd_host))
        ]
        for kind in ("radarr", "sonarr")
    }
    by_id = {result.tmdb_id: result for result, _ in titles}
    return FakeSeerrClient(
        results=[result for result, _ in titles],
        details={(d.media_type, d.tmdb_id): d for _, d in titles},
        collections={
            c.id: Collection(c.id, c.name, tuple(by_id[t] for t in c.parts))
            for c in seed.collections
        },
        user_list=[SeerrUser(u.id, u.email, u.username, u.plex_username) for u in seed.users],
        requests=[_request(n, r, seerr_user_id) for n, r in enumerate(seed.requests, 1)],
        arr_servers=four_k if seed.four_k else {},
        auto_approve=seed.auto_approve,
    )


def _file(f: RadarrFileSeed | SonarrFileSeed, file_id: int, media_id: int) -> MediaFile:
    return MediaFile(
        id=file_id,
        path=f.path,
        size_bytes=int(f.size_gb * GB),
        quality=f.quality,
        release_group=f.release_group,
        media_id=media_id,
        season=f.season,
        audio_languages=tuple(f.audio.split("/")) if f.audio is not None else None,
    )


def _event(n: int, e: HistoryEventSeed) -> HistoryEvent:
    """One entry of a title's download history, newest first as seeded."""
    return HistoryEvent(
        id=n,
        event_type=e.event,
        source_title=e.release,
        date=e.when,
        download_id=e.download_id,
        message=e.why,
        indexer=e.indexer,
    )


def _radarr(host: str, seed: RadarrSeed) -> FakeRadarrClient:
    """A host's movies, their files, what is downloading and what happened to past
    downloads (`history`, per movie id)."""
    events: dict[int, list[HistoryEvent]] = {}
    for n, e in enumerate(seed.history, 1):
        events.setdefault(e.movie_id, []).append(_event(n, e))
    return FakeRadarrClient(
        events=events,
        host=host,
        base_url=ARR_URLS["radarr"].format(host=host),
        file_list=[_file(f, f.id, f.movie_id) for f in seed.files],
        movie_list=[
            Movie(m.id, m.title, m.tmdb_id, m.year, "", True, False, None) for m in seed.movies
        ],
        queue_items=[
            QueueItem(
                id=n,
                title=q.title,
                status=q.status,
                size_bytes=int(q.size_gb * GB),
                size_left_bytes=int(q.left_gb * GB),
                time_left=q.time_left,
                error_messages=tuple(q.messages),
                download_id=q.download_id,
                media_id=q.movie_id,
                tracked_status=q.tracked_status,
            )
            for n, q in enumerate(seed.queue, 1)
        ],
    )


def _sabnzbd(host: str, seed: SabnzbdSeed) -> FakeSabnzbdClient:
    """What a host's SABnzbd finished (`history`: its failure and the steps that went wrong)."""
    return FakeSabnzbdClient(
        host=host,
        history_items=[
            Download(
                nzo_id=d.nzo_id,
                name=d.name,
                status=d.status,
                percent=0.0,
                size_mb=0.0,
                time_left=None,
                fail_message=d.why,
                trouble=tuple(d.steps),
            )
            for d in seed.history
        ],
    )


def _plex(seed: PlexSeed) -> FakePlexClient:
    items = {
        i.rating_key: PlexItem(
            rating_key=i.rating_key,
            title=i.title,
            type=i.type,
            year=i.year,
            guids=(f"tmdb://{i.tmdb_id}",) if i.tmdb_id is not None else (),
            versions=tuple(
                Version(
                    resolution=v.resolution,
                    video_codec=v.codec,
                    bitrate_kbps=int(v.bitrate_mbps * 1000),
                    size_bytes=int(v.size_gb * GB),
                    file=v.file,
                )
                for v in i.versions
            ),
        )
        for i in seed.items
    }
    seasons = {
        key: [PlexSeason(s.number, s.episodes) for s in rows] for key, rows in seed.seasons.items()
    }
    return FakePlexClient(machine_id=PLEX_ID, items=items, show_seasons=seasons)


def _sonarr(host: str, seed: SonarrSeed) -> FakeSonarrClient:
    """A host's shows and their episode files."""
    return FakeSonarrClient(
        host=host,
        base_url=ARR_URLS["sonarr"].format(host=host),
        series_list=[
            Series(
                id=x.id,
                title=x.title,
                tvdb_id=x.tvdb_id,
                year=x.year,
                path="",
                monitored=True,
                series_type=x.type,
                season_numbers=tuple(x.seasons),
            )
            for x in seed.series
        ],
        file_list=[
            _file(f, f.id if f.id is not None else n, f.series_id)
            for n, f in enumerate(seed.files, 1)
        ],
        episode_list=[
            Episode(
                id=e.id,
                series_id=e.series_id,
                season=e.season,
                number=e.number,
                title=e.title,
                has_file=e.file_id is not None,
                file_id=e.file_id,
                monitored=e.monitored,
                aired=datetime.fromisoformat(e.aired) if e.aired is not None else None,
            )
            for e in seed.episodes
        ],
    )


def _session(n: int, x: SessionSeed, user_id: int) -> Session:
    bitrate = int(x.bitrate_mbps * 1000)
    source = x.source_mbps if x.source_mbps is not None else x.bitrate_mbps
    return Session(
        session_key=str(n),
        user_id=x.user_id if x.user_id is not None else user_id,
        user="eval",
        rating_key=x.rating_key,
        full_title=x.title,
        media_type="episode" if x.show_key is not None else "movie",
        state="playing",
        progress_percent=10,
        platform=x.platform,
        player=x.player,
        product=x.product,
        location=x.location,
        relayed=x.relayed,
        secure=True,
        bandwidth_kbps=bitrate,
        stream_bitrate_kbps=bitrate,
        transcode_decision=x.transcode_decision,
        video_decision=x.video_decision,
        audio_decision=x.audio_decision,
        subtitle_decision=x.subtitle_decision,
        container="mkv",
        video_codec=x.video_codec,
        video_resolution="1080",
        video_dynamic_range="SDR",
        audio_codec=x.audio_codec,
        audio_channels=6,
        subtitle_codec=x.subtitle_codec,
        file=x.file,
        show_key=x.show_key or "",
        season=x.season,
        episode=x.episode,
        dovi_profile=x.dovi_profile,
        source_bitrate_kbps=int(source * 1000),
        transcode_speed=x.transcode_speed,
        transcode_throttled=x.throttled,
        tmdb_id=x.tmdb_id,
    )


def _played(n: int, x: PlayedSeed) -> HistoryRow:
    started = int(time.time() - x.days_ago * 86400)
    return HistoryRow(
        user_id=x.user_id,
        rating_key=x.rating_key,
        full_title=x.title,
        media_type="movie",
        started=started,
        stopped=started + 3600,
        percent_complete=90,
        transcode_decision="direct play",
        platform="Roku",
        player="Living Room",
        location=x.location,
        relayed=False,
        row_id=n,
    )


def _tautulli(host: str, seed: TautulliSeed, user_id: int, library: str) -> FakeTautulliClient:
    """A host's live sessions and finished plays (`history`), each naming its title's TMDB
    id as `tmdb_id`. It watches its own host's Plex server; the `library` host's is the one
    sparrow reads."""
    return FakeTautulliClient(
        host=host,
        plex_id=PLEX_ID if host == library else f"{host}-plex",
        sessions=[_session(n, x, user_id) for n, x in enumerate(seed.sessions, 1)],
        history_rows=[_played(n, x) for n, x in enumerate(seed.history, 1)],
        titles={
            x.rating_key: x.tmdb_id
            for x in (*seed.sessions, *seed.history)
            if x.tmdb_id is not None
        },
    )


def _probe(seed: ProbeSeed) -> FakeFileProbe:
    """Files as ffprobe reads them, by path, and what decoding each prints."""
    return FakeFileProbe(
        files={
            path: Inspection(
                path=path,
                duration=f.duration,
                video_codec=f.video_codec,
                dovi_profile=f.dovi_profile,
                tracks=tuple(
                    Track(
                        kind=t.kind,
                        codec=t.codec,
                        language=t.language,
                        title=t.title,
                        forced=t.forced,
                        channels=t.channels,
                    )
                    for t in f.tracks
                ),
            )
            for path, f in seed.files.items()
        },
        errors={path: tuple(lines) for path, lines in seed.errors.items()},
    )


def _fleet(seed: dict[str, VitalsSeed]) -> FakeFleetMonitor:
    """Each NAS's CPU and memory, in percent, as the fleet monitor reads them."""
    return FakeFleetMonitor({host: Vitals(v.cpu, v.memory) for host, v in seed.items()})


def _speedtest(seed: SpeedSeed) -> FakeSpeedTest:
    result = (
        SpeedResult(
            upload_kbps=round(seed.upload_mbps * 1000),
            download_kbps=round(seed.download_mbps * 1000),
            ping_ms=seed.ping_ms,
            server=seed.server,
            isp=seed.isp,
            url="https://www.speedtest.net/result/c/eval",
        )
        if seed.upload_mbps is not None
        else None
    )
    return FakeSpeedTest(host=seed.host, result=result)


def _raven(seed: RavenSeed) -> FakeRavenClient:
    """raven's libraries as a case lists them: each entry one library's copy of a title.
    Its people each list their filmography; a work named like a title in raven is that item."""
    titles = [
        RavenTitle(
            library_id=t.library_id,
            library=t.library,
            kind=t.kind,
            title=t.title,
            year=t.year,
            item_id=t.item_id if t.item_id is not None else n + 1,
            quality=t.quality,
            hdr=t.hdr,
            episodes=t.episodes,
            released=t.released,
        )
        for n, t in enumerate(seed.titles)
    ]
    items = {(t.kind, t.title): t.item_id for t in titles}
    persons = [
        RavenPerson(
            id=n + 1,
            name=p.name,
            known_for=p.known_for,
            works=tuple(
                Work(
                    kind=w.kind,
                    title=w.title,
                    year=int(w.released[:4]) if w.released else None,
                    released=w.released,
                    parts=(Part(w.department, w.role),),
                    item_id=items.get((w.kind, w.title)),
                )
                for w in sorted(p.works, key=lambda w: w.released or "9999", reverse=True)
            ),
            complete=True,
        )
        for n, p in enumerate(seed.people)
    ]
    return FakeRavenClient(titles=titles, persons=persons)


def _arr_libraries(
    seed: dict[ArrService, dict[str, ArrLibrarySeed]],
) -> dict[ArrService, dict[str, FakeArrLibrary]]:
    """Each arr as a case lists it, by service and host: its records as the arr's API
    gives them, its saved custom filters and its root folders."""
    return {
        service: {
            host: FakeArrLibrary(
                service=service,
                host=host,
                records=[dict(r) for r in arr.records],
                filters=[CustomFilter(f.label, f.type, tuple(f.filters)) for f in arr.filters],
                roots=[RootFolder(p, 8_000_000_000_000, 16_000_000_000_000) for p in arr.roots],
            )
            for host, arr in hosts.items()
        }
        for service, hosts in seed.items()
    }


def build_services(seed: Seed, seerr_user_id: int = 4) -> Services:
    hosts = seed.hosts
    tautulli_user = seed.user.tautulli_user_id or 0
    services = Services(
        seerr=_seerr(seed.seerr, seerr_user_id, hosts),
        plex=_plex(seed.plex),
        wizarr=FakeWizarrClient(),
        sonarr={h: _sonarr(h, seed.sonarr.get(h, SonarrSeed())) for h in hosts},
        radarr={h: _radarr(h, seed.radarr.get(h, RadarrSeed())) for h in hosts},
        sabnzbd={h: _sabnzbd(h, seed.sabnzbd.get(h, SabnzbdSeed())) for h in hosts},
        tautulli={
            h: _tautulli(h, seed.tautulli.get(h, TautulliSeed()), tautulli_user, hosts[0])
            for h in hosts
        },
        probe=_probe(seed.probe),
        fleet=_fleet(seed.fleet) if seed.fleet is not None else None,
        speedtest=_speedtest(seed.speedtest) if seed.speedtest is not None else None,
        plextv=FakePlexTv(),
        raven=_raven(seed.raven),
        arr_libraries=_arr_libraries(seed.arr_libraries),
    )
    for name in seed.down:
        service, _, host = name.partition(":")
        client = getattr(services, service)
        (client[host] if host else client).down = True
    return services


def build_world(seed: Seed) -> tuple[ToolRegistry, Services, Store]:
    store = Store(":memory:")
    user = seed.user
    store.upsert_user(
        EVAL_USER,
        seerr_user_id=user.seerr_user_id,
        tautulli_user_id=user.tautulli_user_id,
        plex_username=user.plex_username,
    )
    return app_registry, build_services(seed, user.seerr_user_id), store
