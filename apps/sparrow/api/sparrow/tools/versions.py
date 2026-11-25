"""Which version of a movie will stream well on a friend's connection.

`pick_version` lists every file of the movie in raven with its bitrate and
recommends the best one the friend's connection carries
(`sparrow/perf/versions.py`): the tightest of the speed they give and the
servers' free upload at the last speed test. With neither, a typical
connection away from home is assumed, and the reply says so. It only reads.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from sparrow.agent.tools import Failed, Refused, Result, Tier, ToolContext, tool
from sparrow.clients import ClientError
from sparrow.formatting import mbps
from sparrow.media import MediaType
from sparrow.perf.uplink import recent
from sparrow.perf.versions import Connection, item_for, probed, recommend

GUESSED = (
    "Nothing about their connection is known, so this assumes a typical connection away from "
    "home. A speed from fast.com (connection_mbps) makes it exact."
)


@tool(
    "pick_version",
    "Which version of a movie to play on the user's connection ('I'm on hotel wifi, which "
    "Dune should I watch?'): every file of it in raven with its bitrate, and the one "
    "recommended, with what to pick in the player's Quality menu when even the lightest is "
    "too heavy. The connection is the tightest of what's known: the speed they give "
    "(connection_mbps, from fast.com say) and the servers' free upload at the last speed "
    "test. Movies only.",
    tier=Tier.FRIEND,
)
async def pick_version(
    ctx: ToolContext,
    tmdb_id: Annotated[int, Field(description="The movie's TMDB id.")],
    connection_mbps: Annotated[
        float | None, Field(description="Their download speed in Mbps, when they give one.")
    ] = None,
) -> dict[str, Any] | Result:
    if connection_mbps is not None and connection_mbps <= 0:
        return Refused("connection_mbps must be a speed above 0.")
    details = await ctx.services.seerr.media_details(MediaType.MOVIE, tmdb_id)
    try:
        item = await item_for(ctx.raven, details)
    except ClientError as exc:
        return Failed(f"raven couldn't be searched for {details.display}: {exc}", retryable=True)
    files = probed(item.files) if item else []
    connection = Connection.of(said_mbps=connection_mbps, uplink=recent(ctx.memo))
    pick = recommend(files, connection.limit())
    if pick is None:
        return {"title": details.display, "versions": [], "note": "No version of it is in raven."}
    reply: dict[str, Any] = {
        "title": details.display,
        "versions": [{"version": f.name, "bitrate_mbps": mbps(f.bitrate_kbps or 0)} for f in files],
        "recommended": {
            "version": pick.file.name,
            "fits": pick.fits,
            "quality_menu": pick.quality,
            "connection": f"about {mbps(pick.limit.kbps):g} Mbps: {pick.limit.source}",
        },
    }
    if not connection.limits:
        reply["note"] = GUESSED
    return reply
