"""Playback problems, from "this won't play" to a recorded report.

`recent_sessions` finds what the friend is watching or just watched on any
host and offers it as a picker, so they confirm the title and copy with
one tap before anything is checked. With nothing recent, the model asks for
the title and uses the search picker instead.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from maester.agent.tools import Choice, Choices, Tier, ToolContext, tool
from maester.clients.seerr import MediaDetails
from maester.playback.items import episode_code, item_ref, item_title
from maester.playback.plays import Play, copy_of, identify, recent_plays
from maester.tools.status import humanized

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
