"""Franchises in one ask: a TMDB collection's entries, and a request for each missing one.

`find_collection` shows every entry of the collection a movie belongs to as
a picker labeled with availability, led by an "all missing" option when
more than one is missing. `request_collection` makes one Seerr request per
missing entry, as the friend, and sums them up in one result. The friend's
Seerr movie quota is checked first: a collection that needs more requests
than the quota has left is not half-requested; the friend is told and picks.
When nothing is requested (nothing missing, not enough quota, every request
refused), the tool refuses (`Result.refusal`) and says why.
"""

from __future__ import annotations

from typing import Any

from luwin.agent.tools import Choice, Choices, Result, Tier, ToolContext, tool
from luwin.clients.seerr import Collection, RequestRefused, RequestStatus, SearchResult
from luwin.tools.requests import explain
from luwin.tools.search import as_choice, availability


def missing(collection: Collection) -> list[SearchResult]:
    return [p for p in collection.parts if p.status.requestable]


@tool(
    "find_collection",
    "The collection (franchise) a movie belongs to, e.g. every Mission: Impossible film. "
    "The user is shown a picker of the entries with their availability, led by an option "
    "to request every missing one; wait for their pick. Picking that option means calling "
    "request_collection.",
    {
        "type": "object",
        "properties": {
            "tmdb_id": {"type": "integer", "description": "TMDB id of any movie in it."},
        },
        "required": ["tmdb_id"],
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
)
async def find_collection(ctx: ToolContext, tmdb_id: int) -> dict[str, Any] | Choices:
    seerr = ctx.services.seerr
    movie = await seerr.media_details("movie", tmdb_id)
    if movie.collection_id is None:
        return {"collection": None, "note": f"{movie.display} isn't part of a collection."}
    collection = await seerr.collection(movie.collection_id)
    gaps = missing(collection)
    if not gaps:
        return {
            "collection": collection.name,
            "note": "Every entry is already on the server or requested.",
            "entries": [
                {"title": p.title, "year": p.year, "availability": availability(p)}
                for p in collection.parts
            ],
        }
    entries = [as_choice(p) for p in collection.parts]
    if len(gaps) == 1:
        return Choices(entries)
    everything = Choice(
        label=f"All {len(gaps)} missing from {collection.name}",
        value=f"collection:{collection.id}",
        detail="One request per missing entry: " + ", ".join(p.title for p in gaps),
    )
    return Choices([everything, *entries])


@tool(
    "request_collection",
    "Request every entry of a collection that isn't on the server or requested yet, one "
    "Seerr request each, as the user. Checks the user's movie quota first and requests "
    "nothing when the collection needs more than is left.",
    {
        "type": "object",
        "properties": {
            "collection_id": {
                "type": "integer",
                "description": "The collection id, from find_collection's collection:<id> option.",
            },
        },
        "required": ["collection_id"],
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
    held_in_maintenance=True,
)
async def request_collection(ctx: ToolContext, collection_id: int) -> dict[str, Any] | Result:
    user = ctx.linked_user()
    seerr = ctx.services.seerr
    collection = await seerr.collection(collection_id)
    gaps = missing(collection)
    reply: dict[str, Any] = {
        "collection": collection.name,
        "already_there": [
            {"title": p.title, "status": p.status.label}
            for p in collection.parts
            if not p.status.requestable
        ],
    }
    if not gaps:
        return Result.refusal(
            f"Nothing was requested: every entry of {collection.name} is already on the server "
            "or requested."
        )
    quota = (await seerr.quota(user.seerr_user_id)).movie
    if quota.remaining is not None and len(gaps) > quota.remaining:
        return Result.refusal(
            f"Nothing was requested: {collection.name} needs {len(gaps)} movie requests "
            f"({', '.join(p.title for p in gaps)}), but this account has {quota.remaining} of "
            f"{quota.limit} left for the next {quota.days} days. Ask which ones they want most."
        )
    requested, refused = [], []
    # One at a time: each request counts against the quota the next one sees.
    for part in gaps:
        try:
            req = await seerr.create_request("movie", part.tmdb_id, as_user=user.seerr_user_id)
        except RequestRefused as exc:
            refused.append(
                {"title": part.title, "reason": await explain(seerr, user, exc, "movie")}
            )
            continue
        requested.append(
            {
                "title": part.title,
                "request_id": req.id,
                "auto_approved": req.status == RequestStatus.APPROVED,
            }
        )
    if not requested:
        why = "; ".join(f"{r['title']}: {r['reason']}" for r in refused)
        return Result.refusal(f"Seerr took none of {collection.name}'s requests. {why}")
    return {**reply, "requested": requested, **({"refused": refused} if refused else {})}
