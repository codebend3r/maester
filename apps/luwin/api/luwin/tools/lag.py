"""Why things are slow: the friend's stream, how busy the servers are, how much upload is left.

`session_report` reads the friend's live streams on every host and gives one
fix each (`maester/perf/lag.py`): what the stream is doing in a line (how it
plays, where, its bitrate, Plex's relay, the app and player, the server
sending it) and the advice. The stats behind it come only when asked
(`details`), so the reply is a fix, not a wall of numbers.

`server_status` reads every Plex host's load at once (`maester/perf/load.py`):
its streams, conversions and bandwidth from Tautulli, CPU and memory from the
fleet monitor where one is set up, and says whether load could be the cause.

`speed_test` measures the servers' shared internet connection from the NAS
maester runs on and puts the upload it finds next to the remote streams
going out (`maester/perf/uplink.py`). Tests are rationed, since each one
briefly fills the upload for everyone.
"""

from __future__ import annotations

import asyncio
from typing import Any

from maester.agent.tools import Result, Tier, ToolContext, tool
from maester.perf import reencode, uplink
from maester.perf.lag import diagnose, live_streams
from maester.perf.load import read_loads
from maester.playback.plays import library_hosts

NOTHING_PLAYING = (
    "Nothing is playing for them on {where} right now. Ask them to start it and tell you once "
    "it stutters; server_status says whether the servers are busy."
)
IN_BRIEF = (
    "Tell them the advice in a sentence or two, without the stats. If they ask for the "
    "details, call session_report with details=true."
)


@tool(
    "session_report",
    "What the user's stream is doing right now, and the one fix for lag or stutter. For each "
    "of their live streams: the server sending it, how it plays (direct play, direct stream "
    "or transcode), over the home network or the internet, its bitrate, whether Plex relays "
    "it (at most 2 Mbps), the app and player, and `advice`: the cause and what to do. Reply "
    "with the advice, not the stats; with details=true it adds every finding and the numbers "
    "behind them, for when they ask.",
    {
        "type": "object",
        "properties": {
            "details": {
                "type": "boolean",
                "description": "Every finding and the stats behind them, when they ask.",
            }
        },
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
)
async def session_report(ctx: ToolContext, details: bool = False) -> dict[str, Any] | Result:
    link = ctx.linked_user()
    if link.tautulli_user_id is None:
        return Result.refusal(
            "Their Plex account isn't matched to a Tautulli user, so their stream can't be found."
        )
    services = ctx.services
    loads, library = await asyncio.gather(read_loads(services), library_hosts(services))
    tester = services.speedtest
    measured = uplink.recent(ctx.memo)
    streams = await live_streams(services, loads.hosts, link.tautulli_user_id, measured, library)
    found = [diagnose(stream) for stream in streams]
    reply: dict[str, Any] = {"streams": [d.details() if details else d.brief() for d in found]}
    if not streams:
        seen = f"the servers that answered ({', '.join(sorted(loads.hosts))})"
        reply["note"] = NOTHING_PLAYING.format(where=seen if loads.unreachable else "any server")
    elif not details:
        reply["note"] = IN_BRIEF
    notes = [f"couldn't reach Tautulli on {h}: {why}" for h, why in loads.unreachable.items()]
    away = any(s.playback.remote for s in streams)
    if tester is not None and measured is None and away and uplink.can_test(ctx.memo, tester):
        notes.append(
            "The servers' upload hasn't been tested in the last 10 minutes. If the advice "
            f"doesn't settle it, speed_test(host={tester.host}) checks it; then call "
            "session_report again."
        )
    if notes:
        reply["notes"] = notes
    # The version a stream plays may be a remux worth re-encoding.
    flagged = await asyncio.gather(*(reencode.flag(services, ctx.store, s) for s in streams))
    notices = tuple(notice for notice in flagged if notice is not None)
    return Result(reply, notices) if notices else reply


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
