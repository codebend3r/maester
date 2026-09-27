"""Why things are slow: how busy the servers are, and how much upload is left.

`server_status` reads every Plex host's load at once (`maester/perf/load.py`):
its streams, conversions and bandwidth from Tautulli, CPU and memory from the
fleet monitor where one is set up, and says whether load could be the cause.

`speed_test` measures the servers' shared internet connection from the NAS
maester runs on and puts the upload it finds next to the remote streams
going out (`maester/perf/uplink.py`). Tests are rationed, since each one
briefly fills the upload for everyone.
"""

from __future__ import annotations

from typing import Any

from maester.agent.tools import Result, Tier, ToolContext, tool
from maester.perf import uplink
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


@tool(
    "speed_test",
    "Test the servers' internet connection now, from the NAS maester runs on: upload, "
    "download and ping, next to the remote streams going out, with `headroom` saying in plain "
    "words how much upload is left. Use it when a friend away from home reports lag. It "
    "takes about 30 seconds and briefly fills the upload, so it's rationed: a result is "
    "reused for 10 minutes and a new test runs at most every 20 (`next_test`). host is the "
    "NAS to test from; only the one maester runs on can.",
    {
        "type": "object",
        "properties": {"host": {"type": "string", "description": "The NAS to test from."}},
        "required": ["host"],
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
    host_param="host",
)
async def speed_test(ctx: ToolContext, host: str) -> dict[str, Any] | Result:
    tester = ctx.services.speedtest
    if tester is None:
        return Result.refusal("No speed test is set up on this server (SPEEDTEST_HOST).")
    if host.lower() != tester.host:
        return Result.refusal(
            f"Speed tests run on {tester.host}, where maester runs; the servers share one "
            f"internet connection, so test from {tester.host}."
        )
    found = await uplink.reading(ctx.memo, ctx.services, tester)
    match found.found:
        case uplink.NotMeasured(why=why):
            return Result.refusal(f"The speed test on {tester.host} failed: {why}. {found.wait()}")
        case uplink.Uplink():
            return found.as_dict()
