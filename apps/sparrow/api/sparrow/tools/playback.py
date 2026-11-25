"""Playback problems, from "this won't play" to a recorded report.

`recent_sessions` finds what the friend just watched in raven and offers it
as a picker, so they confirm the title and copy with one tap before anything
is checked. With nothing recent, the model asks for the title and uses the
search picker instead.

`report_problem` files a report on a confirmed copy through the one report
flow (`sparrow/playback/reports.py`): the file's check, a decision from
stored evidence, and a Seerr issue as the friend.

`list_tracks` reads one copy's audio and subtitle tracks with ffprobe, to
answer "does this have Spanish subs?". Like every file read, it names a
title and copy, never a path: the file comes from the owning arr.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Annotated, Any

from pydantic import Field

from sparrow.agent.tools import (
    Choice,
    Failed,
    Ok,
    Refused,
    Result,
    Tier,
    ToolContext,
    offer,
    tool,
)
from sparrow.clients import ClientError
from sparrow.clients.seerr import MediaDetails
from sparrow.formatting import humanized
from sparrow.library import NotLocated
from sparrow.media import Copy, MediaType, Version, copy_ref, episode_code, titled, version_label
from sparrow.playback.diagnosis import FileChecked, TrackList, read_tracks
from sparrow.playback.health import parse_clock
from sparrow.playback.items import locate
from sparrow.playback.plays import Play, recent_plays
from sparrow.playback.reports import ReportKind, file_report

# The copy (and episode) a playback tool is about.
PlayedTmdbId = Annotated[
    int, Field(description="The TMDB id, from recent_sessions or search_media.")
]
WhichCopy = Annotated[Version, Field(description="Which copy.")]
Season = Annotated[int | None, Field(description="Shows only: the season.")]
EpisodeNumber = Annotated[int | None, Field(description="Shows only: the episode.")]

NOTHING_RECENT = (
    "Nothing watched recently shows up. Ask which title (and for a show, which episode) "
    "and find it with search_media."
)


def play_choice(play: Play, details: MediaDetails, now: datetime) -> Choice:
    """A pick for a play: the title and copy (`?` when unclear), when it last played, and
    in which library."""
    version = "?" if play.is_4k is None else version_label(play.is_4k)
    code = episode_code(play.season, play.episode)
    played = datetime.fromisoformat(play.played.played_at)
    when = f"{humanized(int((now - played).total_seconds()))} ago"
    shown = "copy unclear: ask 1080p or 4K" if play.is_4k is None else version
    return Choice(
        label=titled(details.display, code),
        value=copy_ref(details.media_type, details.tmdb_id, version, code),
        year=details.year,
        detail=f"{shown} · {when} · {play.played.library}",
    )


@tool(
    "recent_sessions",
    "What the user watched lately in raven, as a picker of titles with their copy (1080p "
    "or 4K) and episode. Use it first when they report a problem without naming the title "
    "('this won't play'), and have them confirm the title and copy before reporting it. A "
    "pick reads media_type:tmdb_id:version[:SxxEyy], with version ? when the copy is "
    "unclear. What couldn't be looked up is in notes. When it finds nothing, ask which "
    "title and use search_media.",
    tier=Tier.FRIEND,
)
async def recent_sessions(ctx: ToolContext) -> dict[str, Any] | Result:
    try:
        found = await recent_plays(ctx.raven)
    except ClientError as exc:
        return Failed(f"raven couldn't say what they watched: {exc}. {NOTHING_RECENT}")
    titles = await asyncio.gather(
        *(ctx.services.seerr.media_details(p.kind, p.tmdb_id) for p in found.plays),
        return_exceptions=True,
    )
    now = datetime.now(UTC)
    choices, notes = [], list(found.notes)
    for play, title in zip(found.plays, titles, strict=True):
        match title:
            case MediaDetails():
                choices.append(play_choice(play, title, now))
            case BaseException():
                notes.append(f"Seerr couldn't say what {play.played.title} is: {title}")
    if choices:
        return offer(choices, notes)
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
    tier=Tier.FRIEND,
)
async def list_tracks(
    ctx: ToolContext,
    tmdb_id: PlayedTmdbId,
    media_type: MediaType,
    version: WhichCopy,
    season: Season = None,
    episode: EpisodeNumber = None,
) -> dict[str, Any] | Result:
    try:
        copy = Copy.of(media_type, tmdb_id, version, season, episode)
    except ValueError as bad:  # arguments that name no copy
        return Refused(str(bad))
    try:
        located = await locate(ctx.services, copy)
    except NotLocated as exc:
        return Refused(str(exc))
    match await read_tracks(ctx.services.probe, located):
        case TrackList() as found:
            return {"title": located.title, "version": copy.version, **found.as_dict()["tracks"]}
        case FileChecked(health=health):
            return Refused(f"The file couldn't be read: {health.summary}")


@tool(
    "report_problem",
    "Report a problem with one copy (and episode) the user has confirmed. kind: wont_play "
    "(won't start, freezes, errors out: the file is decoded, around `at` when they named a "
    "moment), wrong_title, wrong_episode, cam, "
    "hardcoded_subs (burned-in foreign subtitles), subtitles (missing or out of sync), audio "
    "(out of sync, missing dub), other. Records the report, opens a Seerr issue as the user, "
    "and returns what was found and decided: a new copy to offer with replace_media, or "
    "that it's recorded. Follow its `next`.",
    tier=Tier.FRIEND,
)
async def report_problem(
    ctx: ToolContext,
    tmdb_id: PlayedTmdbId,
    media_type: MediaType,
    version: WhichCopy,
    kind: ReportKind,
    description: Annotated[str, Field(description="The problem in the user's words.")],
    season: Season = None,
    episode: EpisodeNumber = None,
    at: Annotated[
        str | None, Field(description="When it breaks, as H:MM:SS ('freezes at 1:12:30').")
    ] = None,
) -> Result:
    try:
        copy = Copy.of(media_type, tmdb_id, version, season, episode)
        moment = parse_clock(at) if at else None
    except ValueError as bad:  # arguments that name no copy, or no time
        return Refused(str(bad))
    link = ctx.linked_user()
    try:
        located = await locate(ctx.services, copy)
    except NotLocated as exc:
        return Refused(str(exc))
    filed = await file_report(ctx.services, ctx.store, link, located, kind, description, moment)
    return Ok(filed.as_dict(), filed.notices)
