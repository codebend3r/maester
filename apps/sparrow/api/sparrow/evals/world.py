"""Builds the fake service bag and the tool registry an eval case runs in.

Every tool module registers into the process-wide registry, and the case's
seed (`sparrow/evals/seed.py`, checked when the case loads) is turned into
the fakes' records. One `seerr.results`
entry describes a title once: it is both what search finds and what the
details lookup returns. The eval user is an approved raven account linked to
a Seerr user, so tools act as a real friend's would; their raven plays and
live streams are seeded under `raven`, and the files the health check reads
under `probe`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sparrow.agent.tools import ToolRegistry
from sparrow.agent.tools import registry as app_registry
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
from sparrow.clients.arr import HistoryEvent, MediaFile, QueueItem, RootFolder
from sparrow.clients.arr_library import ArrService, CustomFilter, FakeArrLibrary
from sparrow.clients.fleet import Vitals
from sparrow.clients.media import Inspection, Track
from sparrow.clients.radarr import Movie
from sparrow.clients.raven import (
    LiveStream,
    MemberStatus,
    Part,
    PlaybackMode,
    Played,
    RavenFile,
    RavenItem,
    RavenPerson,
    RavenTitle,
    Work,
)
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
from sparrow.evals.seed import (
    ArrLibrarySeed,
    HistoryEventSeed,
    ProbeSeed,
    RadarrFileSeed,
    RadarrSeed,
    RavenFileSeed,
    RavenSeed,
    RequestSeed,
    SabnzbdSeed,
    Seed,
    SeerrSeed,
    SonarrFileSeed,
    SonarrSeed,
    SpeedSeed,
    TitleSeed,
    VitalsSeed,
)
from sparrow.store import Store

# Importing the tools package registers every tool module into app_registry.
import sparrow.tools  # noqa: F401  isort: skip

EVAL_USER = "eval-user"
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
        user_list=[SeerrUser(u.id, u.email.lower(), u.username) for u in seed.users],
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


def _raven_file(f: RavenFileSeed, title: str) -> RavenFile:
    return RavenFile(
        id=f.id,
        title=title,
        width=f.width,
        video_codec=f.codec,
        hdr=f.hdr,
        dolby_vision=f.dolby_vision,
        bitrate_kbps=round(f.bitrate_mbps * 1000),
        size_bytes=int(f.size_gb * GB),
        variant=f.variant,
    )


def _raven(seed: RavenSeed) -> FakeRavenClient:
    """raven as a case lists it: each title one library's copy, the items behind them with
    their files, the eval user's plays and live streams, and its people, who each list
    their filmography; a work named like a title in raven is that item."""
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
    held = {(t.kind, t.title): t.item_id for t in titles}
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
                    item_id=held.get((w.kind, w.title)),
                )
                for w in sorted(p.works, key=lambda w: w.released or "9999", reverse=True)
            ),
            complete=True,
        )
        for n, p in enumerate(seed.people)
    ]
    items = {
        i.id: RavenItem(
            id=i.id,
            kind=i.kind,
            title=i.title,
            year=i.year,
            tmdb_id=i.tmdb_id,
            files=tuple(_raven_file(f, i.title) for f in i.files),
        )
        for i in seed.items
    }
    now = datetime.now(UTC)
    plays = [
        Played(
            media_id=p.media_id,
            played_at=(now - timedelta(days=p.days_ago)).isoformat(),
            library=p.library,
            title=p.title,
            item_id=p.item_id,
            show=p.show,
            show_id=p.show_id,
            season=p.season,
            episode=p.episode,
        )
        for p in seed.plays
    ]
    streams = [
        (
            x.mine,
            LiveStream(
                file=next(f for f in items[x.item_id].files if f.id == x.media_id),
                item_id=x.item_id,
                library=x.library,
                mode=PlaybackMode(x.mode),
                device=x.device,
                browser=x.browser,
                address=x.address,
                send_kbps=round(x.send_mbps * 1000) if x.send_mbps is not None else None,
                quality=x.quality,
            ),
        )
        for x in seed.streams
    ]
    return FakeRavenClient(
        titles=titles,
        persons=persons,
        items=items,
        plays=plays,
        live=[s for _, s in streams],
        mine=[s for mine, s in streams if mine],
    )


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
    services = Services(
        seerr=_seerr(seed.seerr, seerr_user_id, hosts),
        raven=_raven(seed.raven),
        sonarr={h: _sonarr(h, seed.sonarr.get(h, SonarrSeed())) for h in hosts},
        radarr={h: _radarr(h, seed.radarr.get(h, RadarrSeed())) for h in hosts},
        sabnzbd={h: _sabnzbd(h, seed.sabnzbd.get(h, SabnzbdSeed())) for h in hosts},
        probe=_probe(seed.probe),
        fleet=_fleet(seed.fleet) if seed.fleet is not None else None,
        speedtest=_speedtest(seed.speedtest) if seed.speedtest is not None else None,
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
        email=user.email.lower(),
        raven_status=MemberStatus.APPROVED,
        seerr_user_id=user.seerr_user_id,
    )
    return app_registry, build_services(seed, user.seerr_user_id), store
