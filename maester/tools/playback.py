"""Playback problems, from "this won't play" to a recorded report.

`recent_sessions` finds what the friend is watching or just watched on any
host and offers it as a picker, so they confirm the title and copy with
one tap before anything is checked. With nothing recent, the model asks for
the title and uses the search picker instead.

`report_problem` files a report on a confirmed copy through the one report
flow (`maester/playback/reports.py`): the player first, then the file, a
decision from stored evidence, and a Seerr issue as the friend.

`list_tracks` reads one copy's audio and subtitle tracks with ffprobe, to
answer "does this have Spanish subs?". Like every file read, it names a
title and copy, never a path: the file comes from the owning arr.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from maester.agent.tools import Choice, Choices, Result, Tier, ToolContext, tool
from maester.clients.media import Unreadable
from maester.clients.seerr import MediaDetails
from maester.library import OwnerUnknown
from maester.playback import tracks
from maester.playback.health import parse_clock
from maester.playback.items import Item, NotOnServer, episode_code, item_ref, item_title, locate
from maester.playback.plays import Play, copy_of, identify, recent_plays
from maester.playback.reports import ReportKind, file_report
from maester.tools.status import humanized

# The copy (and episode) a playback tool is about.
ITEM_PROPERTIES: dict[str, Any] = {
    "tmdb_id": {
        "type": "integer",
        "description": "The TMDB id, from recent_sessions or search_media.",
    },
    "media_type": {"type": "string", "enum": ["movie", "tv"]},
    "version": {"type": "string", "enum": ["1080p", "4K"], "description": "Which copy."},
    "season": {"type": "integer", "description": "Shows only: the season."},
    "episode": {"type": "integer", "description": "Shows only: the episode."},
}
ITEM_REQUIRED = ["tmdb_id", "media_type", "version"]
ITEM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": ITEM_PROPERTIES,
    "required": ITEM_REQUIRED,
    "additionalProperties": False,
}

NOTHING_RECENT = (
    "Nothing watched recently shows up. Ask which title (and for a show, which episode) "
    "and find it with search_media."
)


def play_choice(play: Play, details: MediaDetails, now: float) -> Choice:
    """A pick for a play: the title and copy, when it was played, and on what."""
    version = {True: "4K", False: "1080p", None: "?"}[copy_of(details, play.plex_key)]
    code = episode_code(play.season, play.episode)
    when = "playing now" if play.live else f"{humanized(int(now) - play.started)} ago"
    shown = "copy unclear: ask 1080p or 4K" if version == "?" else version
    return Choice(
        label=item_title(details, code),
        value=item_ref(details.media_type, details.tmdb_id, version, code),
        year=details.year,
        detail=f"{shown} · {when} · {play.player}",
    )


@tool(
    "recent_sessions",
    "What the user is watching now or watched recently, on every server, as a picker of "
    "titles with their copy (1080p or 4K) and episode. Use it first when they report a "
    "problem without naming the title ('this won't play'), and have them confirm the "
    "title and copy before reporting it. A pick reads media_type:tmdb_id:version[:SxxEyy], "
    "with version ? when the copy is unclear. "
    "When it finds nothing, ask which title and use search_media.",
    {"type": "object", "properties": {}, "additionalProperties": False},
    tier=Tier.FRIEND,
)
async def recent_sessions(ctx: ToolContext) -> dict[str, Any] | Choices:
    link = ctx.linked_user()
    if link.tautulli_user_id is None:
        return {
            "sessions": [],
            "note": "Your Plex account isn't matched to a Tautulli user, so what you watched "
            f"can't be looked up. {NOTHING_RECENT}",
        }
    found = await recent_plays(ctx.services, link.tautulli_user_id)
    titles = await asyncio.gather(
        *(identify(ctx.services, p) for p in found.plays), return_exceptions=True
    )
    now = time.time()
    choices = [
        play_choice(play, details, now)
        for play, details in zip(found.plays, titles, strict=True)
        if isinstance(details, MediaDetails)
    ]
    if choices:
        return Choices(choices)
    reply: dict[str, Any] = {"sessions": [], "note": NOTHING_RECENT}
    if found.unreachable:
        reply["unreachable"] = found.unreachable
    return reply


@tool(
    "list_tracks",
    "The audio and subtitle tracks of one copy's file, read from the file itself, including "
    "subtitle files next to it: language, codec, title, forced, and for audio whether it is "
    "English. Answers 'does this have Spanish subs?' or 'is this one dubbed?'. For a show, "
    "name the episode.",
    {
        "type": "object",
        "properties": ITEM_PROPERTIES,
        "required": ITEM_REQUIRED,
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
)
async def list_tracks(
    ctx: ToolContext,
    tmdb_id: int,
    media_type: str,
    version: str,
    season: int | None = None,
    episode: int | None = None,
) -> dict[str, Any]:
    item = Item.of(media_type, tmdb_id, version, season, episode)
    try:
        located = await locate(ctx.services, item)
    except (NotOnServer, OwnerUnknown) as exc:
        return {"tracks": None, "reason": str(exc)}
    reply: dict[str, Any] = {"title": located.title, "version": item.version}
    try:
        inspection = await ctx.services.probe.inspect(located.file.path)
    except Unreadable as exc:
        return {**reply, "tracks": None, "reason": f"the file couldn't be read: {exc}"}
    return {**reply, **tracks.listing(inspection.tracks)}


@tool(
    "report_problem",
    "Report a problem with one copy (and episode) the user has confirmed. kind: wont_play "
    "(won't start, freezes, errors out: the player is checked first, then the file is "
    "decoded, around `at` when they named a moment), wrong_title, wrong_episode, cam, "
    "hardcoded_subs (burned-in foreign subtitles), subtitles (missing or out of sync), audio "
    "(out of sync, missing dub), other. Records the report, opens a Seerr issue as the user, "
    "and returns what was found and decided: a player fix to relay, a new copy to offer with "
    "replace_media, or that it's recorded. Follow its `next`.",
    {
        "type": "object",
        "properties": {
            **ITEM_PROPERTIES,
            "kind": {"type": "string", "enum": [k.value for k in ReportKind]},
            "description": {"type": "string", "description": "The problem in the user's words."},
            "at": {
                "type": "string",
                "description": "When it breaks, as H:MM:SS ('freezes at 1:12:30').",
            },
        },
        "required": [*ITEM_REQUIRED, "kind", "description"],
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
)
async def report_problem(
    ctx: ToolContext,
    tmdb_id: int,
    media_type: str,
    version: str,
    kind: str,
    description: str,
    season: int | None = None,
    episode: int | None = None,
    at: str | None = None,
) -> dict[str, Any] | Result:
    item = Item.of(media_type, tmdb_id, version, season, episode)
    moment = parse_clock(at) if at else None
    link = ctx.linked_user()
    try:
        located = await locate(ctx.services, item)
    except (NotOnServer, OwnerUnknown) as exc:
        return {"reported": False, "reason": str(exc)}
    filed = await file_report(
        ctx.services, ctx.store, link, located, ReportKind(kind), description, moment
    )
    return Result(filed.as_dict(), filed.notices)
