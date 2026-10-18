"""What is in raven, the suite's own library: which libraries hold a title, and links to it.

raven is where friends browse and play the server's files, so its search is
the plainest answer to "is it on the server?" and "where do I watch it?".
Each match is one library's copy (Movies, 4K Movies, TV Shows...), with its
quality and a raven_link that opens that library's page for it. The chat
shows each matched title once beside the reply, as its logo with a link to
every library's copy.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import Field

from luwin.agent.tools import (
    Failed,
    Refused,
    Result,
    Shown,
    Tier,
    Title,
    TitleLink,
    ToolContext,
    tool,
)
from luwin.clients import ClientError
from luwin.clients.raven import RavenTitle

MAX_MATCHES = 20


def copy_label(copy: RavenTitle) -> str:
    """What a link to one library's copy says: its quality ("4K HDR", "1080p"), or the
    library's name when there is none (a show's "TV Shows")."""
    if copy.quality is None:
        return copy.library
    return f"{copy.quality} HDR" if copy.hdr else copy.quality


def shown_titles(found: list[RavenTitle], base_url: str) -> tuple[Title, ...]:
    """Each matched title once, in the order found, with a link per library holding it."""
    copies: dict[tuple[str, int], list[RavenTitle]] = {}
    for t in found:
        if t.item_id is not None:
            copies.setdefault((t.kind, t.item_id), []).append(t)
    return tuple(
        Title(
            key=f"raven:{kind}:{item_id}",
            title=held[0].title,
            year=held[0].year,
            logo_url=held[0].logo_url(base_url),
            links=tuple(TitleLink(copy_label(c), c.link(base_url) or base_url) for c in held),
        )
        for (kind, item_id), held in copies.items()
    )


@tool(
    "search_library",
    "Looks a title up in raven, the server's own library where friends browse and play "
    "what is on it: every library holding a match (Movies, 4K Movies, TV Shows, Anime...) "
    "with its year, quality (4K, 1080p, HDR) or episode count, and a raven_link that opens "
    "it; link it in your reply, on the title. Use it first when someone asks whether something "
    "is on the server or where to watch it. It matches by title, so search the title, not "
    "a description; nothing found means it isn't in raven.",
    tier=Tier.FRIEND,
)
async def search_library(
    ctx: ToolContext,
    title: Annotated[str, Field(description="The title, or a word from it.", min_length=1)],
) -> Shown | Result:
    raven = ctx.services.raven
    if raven is None:
        return Refused("raven isn't set up on this server (RAVEN_URL).")
    try:
        found = await raven.search(title)
        if not found and title.lower().endswith("s"):
            # raven matches part of a title, so "Terminators" finds what "Terminator" does.
            found = await raven.search(title[:-1])
    except ClientError as exc:
        # Asking again won't reach it either; the model should say so and stop.
        return Failed(
            f"raven at {raven.base_url} isn't answering ({exc.detail}), so its library can't be "
            "searched right now. Don't call search_library again this turn: say raven is "
            "unreachable, and that the admin can check it."
        )
    matches = [
        {
            "title": t.title,
            "year": t.year,
            "kind": t.kind,
            "library": t.library,
            **({"quality": t.quality} if t.quality else {}),
            **({"hdr": True} if t.hdr else {}),
            **({"versions": t.versions} if t.versions > 1 else {}),
            **({"episodes": t.episodes} if t.episodes is not None else {}),
            "raven_link": t.link(raven.base_url),
        }
        for t in found[:MAX_MATCHES]
    ]
    reply: dict[str, Any] = {"query": title, "matches": matches}
    if not matches:
        reply["note"] = "Nothing in raven matches; it isn't on the server under that title."
    elif len(found) > MAX_MATCHES:
        reply["note"] = f"{len(found) - MAX_MATCHES} more matches left out; search more narrowly."
    return Shown(reply, shown_titles(found[:MAX_MATCHES], raven.base_url))
