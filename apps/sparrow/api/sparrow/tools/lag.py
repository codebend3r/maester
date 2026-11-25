"""Why things are slow: the friend's stream, how busy the servers are, how much upload is left.

`session_report` reads the friend's own live streams in raven and gives one
fix each (`sparrow/perf/lag.py`): what the stream is doing in a line (how
raven sends it, where, the file, the player) and the advice. The stats
behind it come only when asked (`details`), so the reply is a fix, not a
wall of numbers.

`server_status` reads each NAS's CPU and memory from the fleet monitor where
one is set up, and for the admin what raven is sending everyone
(`sparrow/perf/load.py`), and says whether load could be the cause.

`speed_test` measures the servers' shared internet connection from the NAS
sparrow runs on: the upload the streams going out leave free
(`sparrow/perf/uplink.py`). Tests are rationed, since each one briefly
fills the upload for everyone.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from sparrow.agent.tools import Failed, Refused, Result, Tier, ToolContext, tool
from sparrow.clients import ClientError
from sparrow.perf import uplink
from sparrow.perf.lag import diagnose, live_streams
from sparrow.perf.load import read_loads

NOTHING_PLAYING = (
    "Nothing is playing for them in raven right now. Ask them to start it and tell you once "
    "it stutters; server_status says whether the servers are busy."
)
IN_BRIEF = (
    "Tell them the advice in a sentence or two, without the stats. If they ask for the "
    "details, call session_report with details=true."
)


@tool(
    "session_report",
    "What the user's stream in raven is doing right now, and the one fix for lag or "
    "stutter. For each of their live streams: how raven sends it (as it is, remuxed or "
    "converted), over the home network or the internet, the file playing, the player, and "
    "`advice`: the cause and what to do. Reply with the advice, not the stats; with "
    "details=true it adds every finding and the numbers behind them, for when they ask.",
    tier=Tier.FRIEND,
)
async def session_report(
    ctx: ToolContext,
    details: Annotated[
        bool, Field(description="Every finding and the stats behind them, when they ask.")
    ] = False,
) -> dict[str, Any] | Result:
    raven = ctx.raven
    measured = uplink.recent(ctx.memo)
    try:
        streams = await live_streams(raven, measured)
    except ClientError as exc:
        return Failed(f"raven couldn't say what is playing for them: {exc}", retryable=True)
    found = [diagnose(stream) for stream in streams]
    reply: dict[str, Any] = {"streams": [d.details() if details else d.brief() for d in found]}
    if not streams:
        reply["note"] = NOTHING_PLAYING
    elif not details:
        reply["note"] = IN_BRIEF
    tester = ctx.services.speedtest
    away = any(s.live.remote for s in streams)
    if tester is not None and measured is None and away and uplink.can_test(ctx.memo, tester):
        reply["notes"] = [
            "The servers' upload hasn't been tested in the last 10 minutes. If the advice "
            f"doesn't settle it, speed_test(host={tester.host}) checks it; then call "
            "session_report again."
        ]
    return reply


@tool(
    "server_status",
    "How busy the servers are right now: each NAS's CPU and memory where the fleet monitor "
    "is set up, and, for the admin, what raven is sending everyone (streams, conversions, "
    "streams away from home). `verdict` says whether load could be why things are slow. Use "
    "when someone asks if the server is busy, or why everything is slow.",
    tier=Tier.FRIEND,
)
async def server_status(ctx: ToolContext) -> dict[str, Any] | Result:
    is_admin = ctx.tier == Tier.ADMIN
    if ctx.services.fleet is None and not is_admin:
        return Refused(
            "No fleet monitor is set up, so there's no CPU or memory to read, and raven's "
            "streams are its owner's to see."
        )
    loads = await read_loads(ctx.services.fleet, ctx.raven if is_admin else None)
    return loads.as_dict()


@tool(
    "speed_test",
    "Test the servers' internet connection now, from the NAS sparrow runs on: upload, "
    "download and ping, with `headroom` saying in plain words how much upload the streams "
    "going out leave free. Use it when a friend away from home reports lag. It takes about "
    "30 seconds and briefly fills the upload, so it's rationed: a result is reused for 10 "
    "minutes and a new test runs at most every 20 (`next_test`). host is the NAS to test "
    "from; only the one sparrow runs on can.",
    tier=Tier.FRIEND,
    host_param="host",
)
async def speed_test(
    ctx: ToolContext, host: Annotated[str, Field(description="The NAS to test from.")]
) -> dict[str, Any] | Result:
    tester = ctx.services.speedtest
    if tester is None:
        return Refused("No speed test is set up on this server (SPEEDTEST_HOST).")
    if host.lower() != tester.host:
        return Refused(
            f"Speed tests run on {tester.host}, where sparrow runs; the servers share one "
            f"internet connection, so test from {tester.host}."
        )
    found = await uplink.reading(ctx.memo, tester)
    match found.found:
        case uplink.NotMeasured(why=why):
            return Refused(f"The speed test on {tester.host} failed: {why}. {found.wait()}")
        case uplink.Uplink():
            return found.as_dict()
