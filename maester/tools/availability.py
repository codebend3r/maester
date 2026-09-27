"""What is on the server: its versions, its seasons, and links that open Plex.

`check_availability` puts Seerr's view (is the standard or the 4K copy
there, which seasons) next to Plex's (every version of the item, how many
episodes each season holds), with a deep link per Plex copy. For shows it
also names the Sonarr host that owns the show, which `follow_show` needs.
"""

from __future__ import annotations

import asyncio
from typing import Any

from maester.agent.tools import Tier, ToolContext, tool
from maester.clients import ClientError, Services
from maester.clients.plex import Plex, Version
from maester.clients.seerr import MediaDetails
from maester.library import AmbiguousOwner, series_owner


def describe_version(version: Version) -> dict[str, Any]:
    return {
        "version": version.label,
        "codec": version.video_codec,
        "size_gb": round(version.size_bytes / 1e9, 1),
        "bitrate_mbps": round(version.bitrate_kbps / 1000, 1),
    }


async def plex_copies(plex: Plex, details: MediaDetails) -> list[dict[str, Any]]:
    """Each Plex item holding the title (standard, 4K), with its link and versions."""
    keys = list(dict.fromkeys(k for k in (details.rating_key, details.rating_key_4k) if k))
    if not keys:
        return []
    machine, *items = await asyncio.gather(plex.machine_identifier(), *map(plex.item, keys))
    return [
        {
            "plex_link": plex.deep_link(machine, key),
            **({"versions": [describe_version(v) for v in item.versions]} if item.versions else {}),
        }
        for key, item in zip(keys, items, strict=True)
        if item is not None
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


async def sonarr_host(services: Services, details: MediaDetails) -> dict[str, Any]:
    """The owning Sonarr host, or why there is none to name."""
    if details.tvdb_id is None:
        return {"sonarr_host": None}
    try:
        owner = await series_owner(services, details.tvdb_id)
    except (AmbiguousOwner, ClientError) as exc:
        return {"sonarr_host": None, "sonarr_note": str(exc)}
    return {"sonarr_host": owner.host if owner else None}


@tool(
    "check_availability",
    "Whether a movie or show is on the server: which versions (1080p, 4K, HEVC re-encode) "
    "with size and bitrate, for shows how many episodes of each season are present, and a "
    "plex_link per copy that opens it in Plex; include the link in your reply. For shows it "
    "also gives sonarr_host, the host follow_show needs.",
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
        reply.update(await sonarr_host(services, details))
    return reply
