"""Why things are slow: how busy the servers are.

`server_status` reads every Plex host's load at once (`maester/perf/load.py`):
its streams, conversions and bandwidth from Tautulli, CPU and memory from the
fleet monitor where one is set up, and says whether load could be the cause.
"""

from __future__ import annotations

from typing import Any

from maester.agent.tools import Result, Tier, ToolContext, tool
from maester.perf.load import read_loads


@tool(
    "server_status",
    "How busy each Plex server is right now: streams, conversions (transcodes) and whether "
    "any runs slower than playback, bandwidth, remote and relayed streams, and each NAS's CPU "
    "and memory where the fleet monitor is set up. `verdict` says whether load could be why "
    "things are slow. Use when someone asks if the server is up or busy, or why everything "
    "is slow.",
    {"type": "object", "properties": {}, "additionalProperties": False},
    tier=Tier.FRIEND,
)
async def server_status(ctx: ToolContext) -> dict[str, Any] | Result:
    if not ctx.services.tautulli:
        return Result.refusal("No Tautulli instance is configured, so there's nothing to read.")
    return (await read_loads(ctx.services)).as_dict()
