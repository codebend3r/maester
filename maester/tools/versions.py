"""Which version of a movie will stream well on a friend's connection.

`pick_version` lists every version of the movie on Plex with its bitrate
(the listing `check_availability` gives, `maester/plex_versions.py`) and
recommends the best one the friend's connection carries
(`maester/perf/versions.py`): the tightest of the speed they give, Plex's
relay on their last play away from home, and the servers' free upload at the
last speed test. With none of those, a typical connection away from home is
assumed, and the reply says so.

Asking about a title also looks at its heavy remuxes: one friends keep
streaming away from home is flagged to the admin as a re-encode candidate
(`maester/perf/reencode.py`), once a month at most.
"""

from __future__ import annotations

import asyncio
from typing import Any

from maester.agent.tools import Result, Tier, ToolContext, tool
from maester.clients.seerr import MediaDetails
from maester.formatting import mbps
from maester.notify import AdminPost
from maester.perf import reencode
from maester.perf.uplink import recent
from maester.perf.versions import Connection, last_away, recommend
from maester.plex_versions import TitleVersion, title_versions

GUESSED = (
    "Nothing about their connection is known, so this assumes a typical connection away from "
    "home. A speed from fast.com (connection_mbps) makes it exact."
)


@tool(
    "pick_version",
    "Which version of a movie to play on the user's connection ('I'm on hotel wifi, which "
    "Dune should I watch?'): every version on the server with its bitrate, and the one "
    "recommended, with the remote quality to set when even the lightest is too heavy. The "
    "connection is the tightest of what's known: the speed they give (connection_mbps, from "
    "fast.com say), their last play away from home, and the servers' free upload at the last "
    "speed test. Movies only.",
    {
        "type": "object",
        "properties": {
            "tmdb_id": {"type": "integer", "description": "The movie's TMDB id."},
            "connection_mbps": {
                "type": "number",
                "description": "Their download speed in Mbps, when they give one.",
            },
        },
        "required": ["tmdb_id"],
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
)
async def pick_version(
    ctx: ToolContext, tmdb_id: int, connection_mbps: float | None = None
) -> dict[str, Any] | Result:
    if connection_mbps is not None and connection_mbps <= 0:
        return Result.refusal("connection_mbps must be a speed above 0.")
    services, link = ctx.services, ctx.linked_user()
    (details, versions, notices), away = await asyncio.gather(
        _title(ctx, tmdb_id), last_away(services, link.tautulli_user_id)
    )
    uplink = recent(ctx.memo, services.speedtest)
    connection = Connection.of(said_mbps=connection_mbps, away=away.playback, uplink=uplink)
    pick = recommend(versions, connection.limit())
    if pick is None:
        return {"title": details.display, "versions": [], "note": "No version of it is on Plex."}
    reply: dict[str, Any] = {
        "title": details.display,
        "versions": [v.as_dict() for v in versions],
        "recommended": {
            "version": pick.version.name,
            "fits": pick.fits,
            "remote_quality": pick.quality,
            "connection": f"about {mbps(pick.limit.kbps):g} Mbps: {pick.limit.source}",
        },
    }
    if not connection.limits:
        reply["note"] = GUESSED
    if away.unreachable:
        reply["plays_not_read"] = f"couldn't read their plays on {', '.join(away.unreachable)}"
    return Result(reply, notices) if notices else reply


async def _title(
    ctx: ToolContext, tmdb_id: int
) -> tuple[MediaDetails, list[TitleVersion], tuple[AdminPost, ...]]:
    """The movie, its versions, and the admin's notices about its heavy remuxes."""
    details = await ctx.services.seerr.media_details("movie", tmdb_id)
    versions = await title_versions(ctx.services.plex, details)
    return (
        details,
        versions,
        await reencode.flag(ctx.services, ctx.store, details.display, versions),
    )
