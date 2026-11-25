"""Where a title stands with Seerr: its copies, its seasons, and, for shows, the owning host.

`check_availability` gives Seerr's view (is the standard or the 4K copy
there, which seasons) for a title, before a request or to say what's
missing. For shows it also names the Sonarr host that owns the show, which
`follow_show` and `find_gaps` need, and for anime it reports which seasons'
files carry English audio. What raven holds, with links to watch it, is
`search_library`'s.
"""

from __future__ import annotations

from typing import Any

from sparrow.agent.tools import Tier, ToolContext, tool
from sparrow.clients import Services
from sparrow.clients.seerr import MediaDetails
from sparrow.dub import dub_coverage, is_anime
from sparrow.library import Library, OwnerUnknown
from sparrow.media import MediaType
from sparrow.tools.args import TmdbId


def season_rows(details: MediaDetails) -> list[dict[str, Any]]:
    return [
        {"season": s.number, "episodes": s.episodes, "status": s.status.label}
        for s in details.seasons
    ]


async def show_details(services: Services, details: MediaDetails) -> dict[str, Any]:
    """The Sonarr host with the standard copy (or why none can be named); for anime,
    which seasons' files have English audio."""
    facts: dict[str, Any] = {"sonarr_host": None}
    try:
        owner = await (await Library.load(services)).owner(details, is_4k=False)
    except OwnerUnknown as exc:
        owner, facts["sonarr_note"] = None, str(exc)
    if owner is not None:
        facts["sonarr_host"] = owner.host
    # Sonarr's series type only matters when TMDB alone doesn't call it anime.
    series = (
        await owner.arr.series_by_tvdb(details.tvdb_id)
        if owner is not None and not details.anime_by_tmdb
        else None
    )
    if is_anime(details, series):
        facts["anime"] = True
        if owner is not None:
            facts["english_audio"] = [s.as_dict() for s in dub_coverage(await owner.files())]
    return facts


@tool(
    "check_availability",
    "Where a movie or show stands with Seerr: whether its 1080p and 4K copies are on the "
    "server, requested or missing, and for shows each season's status and episode count. "
    "For shows it also gives sonarr_host, the host follow_show and find_gaps need, and for "
    "anime how many files of each season have English audio. To say where to watch it, "
    "use search_library.",
    tier=Tier.FRIEND,
)
async def check_availability(
    ctx: ToolContext, tmdb_id: TmdbId, media_type: MediaType
) -> dict[str, Any]:
    services = ctx.services
    details = await services.seerr.media_details(media_type, tmdb_id)
    reply: dict[str, Any] = {
        "title": details.display,
        "availability": details.status.label,
        "availability_4k": details.status_4k.label,
    }
    if media_type == MediaType.TV:
        reply["seasons"] = season_rows(details)
        reply.update(await show_details(services, details))
    return reply
