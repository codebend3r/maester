"""Finding titles through Seerr's TMDB search, and offering a pick when unsure.

`search_media` never guesses between plausible matches. Results whose title
matches the query exactly are the plausible ones; when none match exactly
(a vague or partial query), every result is. One plausible match comes back
as data; several come back as a picker, each card saying whether the title
is already on the server or already requested.
"""

from __future__ import annotations

import re
from typing import Any

from maester.agent.tools import Choice, Choices, Tier, ToolContext, tool
from maester.clients.seerr import MediaStatus, SearchResult

# The disambiguation picker shows at most this many options.
SEARCH_PICKS = 5
OVERVIEW_CHARS = 200

_NOT_ALNUM = re.compile(r"[^0-9a-z]+")


def _normalized(title: str) -> str:
    return _NOT_ALNUM.sub("", title.casefold())


def plausible(query: str, results: list[SearchResult]) -> list[SearchResult]:
    exact = [r for r in results if _normalized(r.title) == _normalized(query)]
    return exact or results


def availability(result: SearchResult) -> str:
    """One line: the standard copy's state, plus the 4K copy's when there is one."""
    line = result.status.label
    if result.status_4k != MediaStatus.UNKNOWN:
        line += f"; 4K {result.status_4k.label}"
    return line


def describe(result: SearchResult) -> dict[str, Any]:
    return {
        "tmdb_id": result.tmdb_id,
        "media_type": result.media_type,
        "title": result.title,
        "year": result.year,
        "overview": result.overview[:OVERVIEW_CHARS],
        "poster_url": result.poster_url,
        "availability": availability(result),
    }


def as_choice(result: SearchResult) -> Choice:
    kind = "Movie" if result.media_type == "movie" else "TV show"
    overview = result.overview[:OVERVIEW_CHARS]
    return Choice(
        label=result.title,
        value=f"{result.media_type}:{result.tmdb_id}",
        year=result.year,
        poster_url=result.poster_url,
        detail=f"{kind} · {availability(result)}" + (f"\n{overview}" if overview else ""),
    )


@tool(
    "search_media",
    "Find a movie or TV show by title through Seerr (TMDB). Returns the match with its TMDB "
    "id, type, year, overview, poster and whether it is already on the server or requested. "
    "When several titles plausibly match, the user is shown a picker; wait for their pick "
    "instead of choosing. For a vague description, search for the title you think is meant "
    "and confirm it with the user before requesting.",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The title to look for."},
            "media_type": {
                "type": "string",
                "enum": ["movie", "tv"],
                "description": "Only movies or only shows, when the user said which.",
            },
            "year": {"type": "integer", "description": "Release year, when the user gave one."},
        },
        "required": ["query"],
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
)
async def search_media(
    ctx: ToolContext, query: str, media_type: str | None = None, year: int | None = None
) -> dict[str, Any] | Choices:
    results = [
        r
        for r in await ctx.services.seerr.search(query)
        if (media_type is None or r.media_type == media_type) and (year is None or r.year == year)
    ]
    if not results:
        return {"results": [], "note": "Nothing matched; try other words or the original title."}
    candidates = plausible(query, results)
    if len(candidates) == 1:
        return {"match": describe(candidates[0])}
    return Choices([as_choice(r) for r in candidates[:SEARCH_PICKS]])
