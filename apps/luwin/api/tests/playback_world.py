"""A small library for playback tests: Dune in 1080p and 4K, and The Bear."""

from dataclasses import replace

from luwin.agent.tools import ToolContext
from luwin.clients.arr import MediaFile
from luwin.clients.media import Inspection, Track
from luwin.clients.plex import PlexItem
from luwin.clients.seerr import ArrRef, MediaDetails, MediaStatus
from luwin.clients.sonarr import Episode
from luwin.media import Copy
from luwin.playback.items import locate
from luwin.playback.reports import Filed, ReportKind, file_report
from tests.factories import seerr_server

S = MediaStatus
DANY = 8008135  # the linked friend's Plex (and Tautulli) user id
DUNE = MediaDetails(
    438631, "movie", "Dune", 2021, "", S.AVAILABLE, S.AVAILABLE,
    rating_key="4348", rating_key_4k="9001", arr=ArrRef(0, 8), arr_4k=ArrRef(1, 8),
    media_id=12, runtime_minutes=155,
)  # fmt: skip
BEAR = MediaDetails(
    136315, "tv", "The Bear", 2022, "", S.AVAILABLE, S.UNKNOWN,
    rating_key="5120", arr=ArrRef(0, 12), tvdb_id=403245, media_id=31, runtime_minutes=30,
)  # fmt: skip
DUNE_4K = "/Vermithor/Movies/Dune (2021)/Dune (2021) Remux-2160p.mkv"
FORKS = "/Meleys/TV/The Bear/Season 02/The Bear - S02E07 - Forks WEBDL-1080p.mkv"
DUNE_4K_ITEM = Copy("movie", 438631, True)
FORKS_ITEM = Copy("tv", 136315, False, 2, 7)
DUNE_4K_TRACKS = (
    Track("audio", "truehd", "eng", "TrueHD Atmos 7.1", default=True, channels=8),
    Track("audio", "ac3", "und", "English Dub", channels=6),
    Track("subtitle", "hdmv_pgs_subtitle", "eng", ""),
    Track("subtitle", "srt", "es", "Dune.es.forced.srt", forced=True, external=True),
)


def stock(ctx: ToolContext) -> ToolContext:
    """Dune's 1080p copy on meleys and its 4K copy (Dolby Vision 7) on vermithor; The Bear
    on meleys, with S02E07 on disk and S02E08 missing."""
    services = ctx.services
    services.seerr.arr_servers = {
        "radarr": [seerr_server(0, "movie", "meleys"), seerr_server(1, "movie", "vermithor", is_4k=True)],
        "sonarr": [seerr_server(0, "tv", "meleys")],
    }  # fmt: skip
    services.seerr.details.update({("movie", 438631): DUNE, ("tv", 136315): BEAR})
    services.radarr["vermithor"].files = [
        MediaFile(55, DUNE_4K, 68_500_000_000, "Remux-2160p", "FraMeSToR", 8)
    ]
    sonarr = services.sonarr["meleys"]
    sonarr.episode_list = [
        Episode(701, 12, 2, 6, "Sundae", True, 71, True),
        Episode(702, 12, 2, 7, "Forks", True, 72, True),
        Episode(703, 12, 2, 8, "Omelette", False, None, True),
    ]
    sonarr.files = [MediaFile(72, FORKS, 1_900_000_000, "WEBDL-1080p", "NTb", 12, 2)]
    services.probe.files[DUNE_4K] = Inspection(DUNE_4K, 9331.0, "hevc", 7, DUNE_4K_TRACKS)
    services.probe.files[FORKS] = Inspection(FORKS, 1980.0, "h264", 0, ())
    services.plex.items.update(
        {
            "9001": PlexItem("9001", "Dune", "movie", 2021, ("tmdb://438631",), ()),
            "5120": PlexItem("5120", "The Bear", "show", 2022, ("tmdb://136315",), ()),
        }
    )
    ctx.store.upsert_user(ctx.user_id, tautulli_user_id=DANY)
    return ctx


def link_pal(ctx: ToolContext) -> None:
    """A second linked friend, Discord id d2."""
    ctx.store.upsert_user("d2", status="active", seerr_user_id=5, plex_username="pal")


async def report(
    ctx: ToolContext,
    copy: Copy,
    kind: ReportKind,
    description: str = "it won't play",
    at: float | None = None,
    user: str = "d1",
) -> Filed:
    """File a report on `copy` as `user`, through the real flow."""
    ctx = replace(ctx, user_id=user)
    located = await locate(ctx.services, copy)
    return await file_report(
        ctx.services, ctx.store, ctx.linked_user(), located, kind, description, at
    )
