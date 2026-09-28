"""Read-only tools any linked friend can use.

`server_status` is the walking-skeleton tool: it proves the loop end to end
with nothing that can go wrong. The performance epic extends it with load,
relay detection and advice.
"""

from __future__ import annotations

from typing import Any

from maester.agent.tools import Result, Tier, ToolContext, tool


@tool(
    "server_status",
    "How busy the Plex server is right now: streams, transcodes and bandwidth per host. "
    "Use when someone asks whether the server is up or busy, or why things feel slow.",
    {"type": "object", "properties": {}, "additionalProperties": False},
    tier=Tier.FRIEND,
)
async def server_status(ctx: ToolContext) -> dict[str, Any] | Result:
    if not ctx.services.tautulli:
        return Result.refusal("No Tautulli instance is configured, so there's nothing to read.")
    hosts: dict[str, Any] = {}
    for host, client in sorted(ctx.services.tautulli.items()):
        try:
            activity = await client.activity()
        except Exception as exc:  # one host down must not hide the other
            hosts[host] = {"reachable": False, "error": f"{type(exc).__name__}: {exc}"}
            continue
        hosts[host] = {
            "reachable": True,
            "streams": activity.stream_count,
            "transcodes": activity.transcode_count,
            "total_bandwidth_mbps": round(activity.total_bandwidth_kbps / 1000, 1),
            "wan_bandwidth_mbps": round(activity.wan_bandwidth_kbps / 1000, 1),
            "relayed_streams": sum(1 for s in activity.sessions if s.relayed),
        }
    return {"hosts": hosts}
