"""Playback problems, from "this won't play" to a recorded report.

`recent_sessions` finds what the friend is watching or just watched on any
host and offers it as a picker, so they confirm the title and copy with
one tap before anything is checked. With nothing recent, the model asks for
the title and uses the search picker instead.

`report_problem` files a report on a confirmed copy through the one report
flow (`luwin/playback/reports.py`): the player first, then the file, a
decision from stored evidence, and a Seerr issue as the friend.

`list_tracks` reads one copy's audio and subtitle tracks with ffprobe, to
answer "does this have Spanish subs?". Like every file read, it names a
title and copy, never a path: the file comes from the owning arr.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from luwin.agent.tools import Choice, Choices, Result, Tier, ToolContext, tool
from luwin.clients.seerr import MediaDetails
from luwin.formatting import humanized
from luwin.library import NotLocated
from luwin.media import Copy, copy_ref, episode_code, titled, version_label
from luwin.playback.diagnosis import FileChecked, TrackList, read_tracks
from luwin.playback.health import parse_clock
from luwin.playback.items import locate
from luwin.playback.plays import Play, identify, recent_plays
from luwin.playback.reports import ReportKind, file_report

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


def play_choice(play: Play, details: MediaDetails, is_4k: bool | None, now: float) -> Choice:
    """A pick for a play: the title and copy (None when unclear), when it was played, and on
    what."""
    version = "?" if is_4k is None else version_label(is_4k)
    code = episode_code(play.season, play.episode)
    when = "playing now" if play.live else f"{humanized(int(now) - play.started)} ago"
    shown = "copy unclear: ask 1080p or 4K" if is_4k is None else version
    return Choice(
        label=titled(details.display, code),
        value=copy_ref(details.media_type, details.tmdb_id, version, code),
        year=details.year,
        detail=f"{shown} · {when} · {play.player}",
    )


@tool(
    "recent_sessions",
    "What the user is watching now or watched recently, on every server, as a picker of "
    "titles with their copy (1080p or 4K) and episode. Use it first when they report a "
    "problem without naming the title ('this won't play'), and have them confirm the "
    "title and copy before reporting it. A pick reads media_type:tmdb_id:version[:SxxEyy], "
    "with version ? when the copy is unclear. What couldn't be looked up is in notes. When "
    "it finds nothing, ask which title and use search_media.",
    {"type": "object", "properties": {}, "additionalProperties": False},
    tier=Tier.FRIEND,
)
async def recent_sessions(ctx: ToolContext) -> dict[str, Any] | Choices | Result:
    link = ctx.linked_user()
    if link.tautulli_user_id is None:
        return Result.refusal(
            "Their Plex account isn't matched to a Tautulli user, so what they watched can't "
            f"be looked up. {NOTHING_RECENT}"
        )
    found = await recent_plays(ctx.services, link.tautulli_user_id)
    titles = await asyncio.gather(
        *(identify(ctx.services, p) for p in found.plays), return_exceptions=True
    )
    now = time.time()
    choices, notes = (
        [],
        [f"couldn't reach Tautulli on {h}: {why}" for h, why in found.unreachable.items()],
    )
    for play, title in zip(found.plays, titles, strict=True):
        match title:
            case MediaDetails():
                choices.append(play_choice(play, title, found.copy_of(play, title), now))
            case BaseException():
                notes.append(f"couldn't tell what {play.title} is: {title}")
    if choices:
        return Choices(choices, tuple(notes))
    if notes:
        return {
            "sessions": [],
            "notes": notes,
            "note": f"Some plays couldn't be read. {NOTHING_RECENT}",
        }
    return {"sessions": [], "note": NOTHING_RECENT}


@tool(
    "list_tracks",
    "The audio and subtitle tracks of one copy's file, read from the file itself, including "
    "subtitle files next to it: language, codec, title, forced, and for audio whether it is "
    "English. Answers 'does this have Spanish subs?' or 'is this one dubbed?'. For a show, "
    "name the episode.",
    ITEM_SCHEMA,
    tier=Tier.FRIEND,
)
async def list_tracks(
    ctx: ToolContext,
    tmdb_id: int,
    media_type: str,
    version: str,
    season: int | None = None,
    episode: int | None = None,
) -> dict[str, Any] | Result:
    try:
        copy = Copy.of(media_type, tmdb_id, version, season, episode)
    except ValueError as bad:  # arguments that name no copy
        return Result.refusal(str(bad))
    try:
        located = await locate(ctx.services, copy)
    except NotLocated as exc:
        return Result.refusal(str(exc))
    match await read_tracks(ctx.services.probe, located):
        case TrackList() as found:
            return {"title": located.title, "version": copy.version, **found.as_dict()["tracks"]}
        case FileChecked(health=health):
            return Result.refusal(f"The file couldn't be read: {health.summary}")


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
) -> Result:
    try:
        copy = Copy.of(media_type, tmdb_id, version, season, episode)
        moment = parse_clock(at) if at else None
    except ValueError as bad:  # arguments that name no copy, or no time
        return Result.refusal(str(bad))
    link = ctx.linked_user()
    try:
        located = await locate(ctx.services, copy)
    except NotLocated as exc:
        return Result.refusal(str(exc))
    filed = await file_report(
        ctx.services, ctx.store, link, located, ReportKind(kind), description, moment
    )
    return Result(filed.as_dict(), filed.notices)
