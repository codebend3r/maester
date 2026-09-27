"""What is on the server: its versions, its seasons, and links that open Plex.

`check_availability` puts Seerr's view (is the standard or the 4K copy
there, which seasons) next to Plex's (every version of the item, how many
episodes each season holds), with a deep link per Plex copy. For shows it
also names the Sonarr host that owns the show, which `follow_show` needs,
and for anime it reports which seasons' files carry English audio.
"""

from __future__ import annotations

import asyncio
from typing import Any

from maester.agent.tools import Tier, ToolContext, tool
from maester.clients import Services
from maester.clients.plex import Plex
from maester.clients.seerr import MediaDetails
from maester.dub import dub_coverage, is_anime
from maester.library import Library, OwnerUnknown
from maester.perf.versions import describe_version, items_of


async def plex_copies(plex: Plex, details: MediaDetails) -> list[dict[str, Any]]:
    """Each Plex item holding the title (standard, 4K), with its link and versions."""
    if not (details.rating_key or details.rating_key_4k):
        return []
    machine, items = await asyncio.gather(plex.machine_identifier(), items_of(plex, details))
    return [
        {
            "plex_link": plex.deep_link(machine, item.rating_key),
            **({"versions": [describe_version(v) for v in item.versions]} if item.versions else {}),
        }
        for item in items
    ]


async def season_counts(plex: Plex, details: MediaDetails) -> list[dict[str, Any]]:
    present = (
        {s.number: s.episodes for s in await plex.seasons(details.rating_key)}
        if details.rating_key
        else {}
    )
    return [
        {
            "season": s.number,
            "episodes_on_server": present.get(s.number, 0),
            "episodes_total": s.episodes,
            "status": s.status.label,
        }
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
    "Whether a movie or show is on the server: which versions (1080p, 4K, HEVC re-encode) "
    "with size and bitrate, for shows how many episodes of each season are present, and a "
    "plex_link per copy that opens it in Plex; include the link in your reply. For shows it "
    "also gives sonarr_host, the host follow_show needs, and for anime how many files of "
    "each season have English audio.",
    {
        "type": "object",
        "properties": {
            "tmdb_id": {"type": "integer", "description": "The TMDB id from search_media."},
            "media_type": {"type": "string", "enum": ["movie", "tv"]},
        },
        "required": ["tmdb_id", "media_type"],
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
)
async def check_availability(ctx: ToolContext, tmdb_id: int, media_type: str) -> dict[str, Any]:
    services = ctx.services
    details = await services.seerr.media_details(media_type, tmdb_id)
    reply: dict[str, Any] = {
        "title": details.display,
        "availability": details.status.label,
        "availability_4k": details.status_4k.label,
        "copies": await plex_copies(services.plex, details),
    }
    if media_type == "tv":
        reply["seasons"] = await season_counts(services.plex, details)
        reply.update(await show_details(services, details))
    return reply
