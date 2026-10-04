"""Missing episodes: what Sonarr expects on the owning host and hasn't got.

`find_gaps` compares the show's episode list in the Sonarr that owns its
standard copy with the files present there. An aired episode with no file
is a gap. A season missing every aired episode is not searched blindly (a
whole season gone is usually a request that never went through, or one
Sonarr can't find), so it goes to the admin instead. Only the scattered
gaps are searched, and the reply lists them. Specials are left out, and an
unmonitored episode is the admin's choice, so it is listed, not searched.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from luwin.agent.tools import Result, Tier, ToolContext, tool
from luwin.clients.sonarr import Episode
from luwin.library import NotLocated, show_owner_on
from luwin.media import episode_code
from luwin.notify import AdminPost


@dataclass(frozen=True)
class Gaps:
    scattered: tuple[Episode, ...]  # monitored, in a season that has some of its episodes
    whole_seasons: dict[int, int]  # season -> its aired episodes, every one missing
    unmonitored: tuple[Episode, ...]


def gaps_in(episodes: Iterable[Episode], now: datetime, season: int | None = None) -> Gaps:
    aired = [
        e
        for e in episodes
        if e.season > 0
        and (season is None or e.season == season)
        and e.aired is not None
        and e.aired <= now
    ]
    by_season: dict[int, list[Episode]] = defaultdict(list)
    for e in aired:
        by_season[e.season].append(e)
    whole = {
        n: len(eps) for n, eps in sorted(by_season.items()) if not any(e.has_file for e in eps)
    }
    missing = [e for e in aired if not e.has_file and e.season not in whole]
    return Gaps(
        scattered=tuple(e for e in missing if e.monitored),
        whole_seasons=whole,
        unmonitored=tuple(e for e in missing if not e.monitored),
    )


def codes(episodes: Iterable[Episode]) -> list[str]:
    return [episode_code(e.season, e.number) for e in episodes]


def note(found: Gaps) -> str:
    if found.whole_seasons:
        return "Whole missing seasons aren't searched blindly; the admin has been told."
    if found.scattered:
        return "Searching for the missing episodes; they usually land within a few hours."
    if found.unmonitored:
        return "The missing episodes aren't monitored, so the admin chose to skip them."
    return "Every episode that has aired is on the server."


@tool(
    "find_gaps",
    "Missing episodes of a show ('S02E07 of The Bear is missing'): compares the episodes "
    "Sonarr expects with the files on the host that owns the show, searches the missing "
    "ones and lists them. A season missing entirely goes to the admin instead. host is the "
    "owning Sonarr host that check_availability reports; season narrows it to one season.",
    {
        "type": "object",
        "properties": {
            "tmdb_id": {"type": "integer", "description": "The show's TMDB id."},
            "host": {"type": "string", "description": "The Sonarr host that owns the show."},
            "season": {"type": "integer", "description": "Only this season."},
        },
        "required": ["tmdb_id", "host"],
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
    host_param="host",
    held_in_maintenance=True,
)
async def find_gaps(
    ctx: ToolContext, tmdb_id: int, host: str, season: int | None = None
) -> dict[str, Any] | Result:
    details = await ctx.services.seerr.media_details("tv", tmdb_id)
    try:
        owner = await show_owner_on(ctx.services, details, host)
    except NotLocated as exc:
        return Result.refusal(str(exc))
    episodes = await owner.episodes()
    found = gaps_in(episodes, datetime.now(UTC), season)
    if found.scattered:
        await owner.search(tuple(e.id for e in found.scattered))
    reply: dict[str, Any] = {
        "title": details.display,
        "host": owner.host,
        "searched": codes(found.scattered),
        "note": note(found),
    }
    if found.unmonitored:
        reply["not_monitored"] = codes(found.unmonitored)
    if not found.whole_seasons:
        return reply
    reply["whole_seasons_missing"] = [
        {"season": n, "aired_episodes": count} for n, count in found.whole_seasons.items()
    ]
    seasons = ", ".join(f"season {n} ({count} aired)" for n, count in found.whole_seasons.items())
    notice = AdminPost(
        f"{ctx.name_of(ctx.user_id)} says {details.display} is missing episodes on {owner.host}. "
        f"None of {seasons} is there, so it wasn't searched: likely a request that never went "
        "through, or a season Sonarr can't find."
    )
    return Result(reply, (notice,))
