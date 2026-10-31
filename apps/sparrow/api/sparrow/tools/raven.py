"""What is in raven, the suite's own library: which libraries hold a title, and links to it.

raven is where friends browse and play the server's files, so its search is
the plainest answer to "is it on the server?" and "where do I watch it?", and
its listings by release date answer "what are the newest movies?". Its people,
everyone credited on its titles with their TMDB filmography, answer "what's
the latest with Bob Odenkirk?" and "which of Nolan's films do we have?".
Each match is one library's copy (Movies, 4K Movies, TV Shows...), with its
quality and a raven_link that opens that library's page for it. The chat
shows each matched title once beside the reply, as its logo with a link to
every library's copy.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Annotated, Any

from pydantic import Field

from sparrow.agent.tools import (
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
from sparrow.clients import ClientError
from sparrow.clients.raven import Department, Raven, RavenPerson, RavenTitle, TitleKind, Work

MAX_MATCHES = 20
# Titles shown as cards when nothing matches exactly: the closest few, not every substring hit.
MAX_CARDS = 6
ARTICLES = ("the ", "a ", "an ")
NEWEST_COUNT = 10
MAX_NEWEST = 25
# A person's titles in raven listed in full up to this many, the newest first.
MAX_HELD = 40
UPCOMING_COUNT = 5
# raven waits a moment for TMDB on a person's first look; one more ask after this usually has it.
FILMOGRAPHY_WAIT_S = 3.0


def _bare(text: str) -> str:
    """A title as compared: lower case, without a leading article."""
    lowered = text.strip().lower()
    return next((lowered[len(a) :] for a in ARTICLES if lowered.startswith(a)), lowered)


def closeness(found: RavenTitle, query: str) -> int:
    """How well a title fits what was searched, best first: the title itself ("House"), one
    that starts with it ("House of Cards"), one with it as a word ("Road House"), then any
    title containing it ("Lighthouse"). raven finds them all, sorted by title alone."""
    title, wanted = _bare(found.title), _bare(query)
    if title == wanted:
        return 0
    if title.startswith(f"{wanted} ") or title.startswith(f"{wanted}:"):
        return 1
    if f" {wanted} " in f" {title} ":
        return 2
    return 3


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
        return unreachable(raven.base_url, exc.detail, "search_library")
    # Stable, so titles that fit as well keep raven's order.
    found = sorted(found, key=lambda t: closeness(t, title))
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
    exact = [t for t in found if closeness(t, title) == 0]
    cards = shown_titles(exact or found[:MAX_MATCHES], raven.base_url)
    return Shown(reply, cards if exact else cards[:MAX_CARDS])


def unreachable(base_url: str, detail: str, name: str) -> Failed:
    """raven didn't answer; asking again this turn won't reach it either."""
    return Failed(
        f"raven at {base_url} isn't answering ({detail}), so its library can't be read "
        f"right now. Don't call {name} again this turn: say raven is unreachable, and that "
        "the admin can check it."
    )


def newest_released(found: list[RavenTitle], today: str, count: int) -> list[list[RavenTitle]]:
    """The `count` latest titles released by `today`, each with every library's copy of it.
    A title with no release date or one still to come is left out; ties keep raven's order."""
    copies: dict[tuple[str, int], list[RavenTitle]] = {}
    for t in found:
        if t.item_id is not None and t.released and t.released <= today:
            copies.setdefault((t.kind, t.item_id), []).append(t)
    ranked = sorted(copies.values(), key=lambda held: held[0].released or "", reverse=True)
    return ranked[:count]


@tool(
    "newest_in_library",
    "The latest released movies (kind=movie) or TV shows (kind=show) on the server, from "
    "raven: every unlocked movie or show library, sorted by release date (a show's "
    "premiere), the newest first, leaving out anything not out yet. Each comes with its "
    "release date, the libraries holding it and a raven_link; link each title in your reply. "
    'Use it for "what are the newest movies?", "any new shows?" or "what came out '
    'recently?"; it is about release dates, not when a file was added.',
    tier=Tier.FRIEND,
)
async def newest_in_library(
    ctx: ToolContext,
    kind: TitleKind,
    count: Annotated[
        int, Field(description="How many titles to list.", ge=1, le=MAX_NEWEST)
    ] = NEWEST_COUNT,
) -> Shown | Result:
    raven = ctx.services.raven
    if raven is None:
        return Refused("raven isn't set up on this server (RAVEN_URL).")
    try:
        found = await raven.newest(kind)
    except ClientError as exc:
        return unreachable(raven.base_url, exc.detail, "newest_in_library")
    today = datetime.now(ctx.settings.jobs.zone).date().isoformat()
    newest = newest_released(found, today, count)
    titles = [
        {
            "title": held[0].title,
            "year": held[0].year,
            "released": held[0].released,
            "libraries": [c.library for c in held],
            **({"episodes": held[0].episodes} if held[0].episodes is not None else {}),
            "raven_link": held[0].link(raven.base_url),
        }
        for held in newest
    ]
    reply: dict[str, Any] = {"kind": kind, "today": today, "titles": titles}
    if not titles:
        reply["note"] = f"raven has no released {kind}s with a release date."
    shown = [copy for held in newest for copy in held]
    return Shown(reply, shown_titles(shown, raven.base_url))


def _counts(work: Work, job: Department | None) -> bool:
    """Whether a work is one the question is about: a part in `job` (any part without one),
    and not only appearances as themselves, which talk shows are full of."""
    parts = [p for p in work.parts if job is None or p.department == job]
    return any(not p.is_self for p in parts)


def _work_entry(work: Work, base_url: str) -> dict[str, Any]:
    link = work.link(base_url)
    return {
        "title": work.title,
        "kind": work.kind,
        "year": work.year,
        **({"released": work.released} if work.released else {}),
        "parts": [
            {"department": p.department, **({"role": p.role} if p.role else {})}
            for p in work.parts
            if not p.is_self
        ],
        "on_server": link is not None,
        **({"raven_link": link} if link else {}),
    }


def _held_title(work: Work, base_url: str) -> Title:
    link = work.link(base_url) or base_url
    return Title(
        key=f"raven:{work.kind}:{work.item_id}",
        title=work.title,
        year=work.year,
        logo_url=work.logo_url(base_url),
        links=(TitleLink("raven", link),),
    )


async def _read_person(raven: Raven, person_id: int) -> RavenPerson:
    """The person's page, asked once more when raven was still fetching their filmography."""
    person = await raven.person(person_id)
    if not person.pending:
        return person
    await asyncio.sleep(FILMOGRAPHY_WAIT_S)
    return await raven.person(person_id)


@tool(
    "search_people",
    "Looks an actor, director, writer or producer up by name in raven: the movies and shows "
    "on the server they are credited on (on_server, every one, newest first, each with a "
    "raven_link), their latest released work from TMDB whether or not it is on the server "
    "(latest, each marked on_server), and what is still to come (upcoming). Use it for "
    '"what are the latest movies starring X?", "what do we have with X?", "has X directed '
    'anything we have?". Narrow with kind (movie or show) and job (acting, directing, '
    "writing, producing, crew). Link what is on the server; for what isn't, offer to "
    "look it up with search_media to request it.",
    tier=Tier.FRIEND,
)
async def search_people(
    ctx: ToolContext,
    name: Annotated[str, Field(description="The person's name, or part of it.", min_length=2)],
    kind: TitleKind | None = None,
    job: Department | None = None,
    count: Annotated[
        int, Field(description="How many of their latest titles to list.", ge=1, le=MAX_NEWEST)
    ] = NEWEST_COUNT,
) -> Shown | Result:
    raven = ctx.services.raven
    if raven is None:
        return Refused("raven isn't set up on this server (RAVEN_URL).")
    try:
        matches = await raven.people(name)
        if not matches:
            return Shown(
                {
                    "query": name,
                    "people": [],
                    "note": (
                        "No one by that name is credited on any movie or show in raven, so "
                        "raven knows nothing of their work. Check the spelling (accents "
                        "count); otherwise say none of their titles are on the server."
                    ),
                },
                (),
            )
        person = await _read_person(raven, matches[0].id)
    except ClientError as exc:
        return unreachable(raven.base_url, exc.detail, "search_people")
    today = datetime.now(ctx.settings.jobs.zone).date().isoformat()
    works = [w for w in person.works if (kind is None or w.kind == kind) and _counts(w, job)]
    held = [w for w in works if w.item_id is not None]
    released = [w for w in works if w.released and w.released <= today]
    upcoming = sorted(
        (w for w in works if w.released and w.released > today), key=lambda w: w.released or ""
    )
    reply: dict[str, Any] = {
        "person": person.name,
        **({"known_for": person.known_for} if person.known_for else {}),
        "raven_link": person.link(raven.base_url),
        "today": today,
        "on_server": [_work_entry(w, raven.base_url) for w in held[:MAX_HELD]],
    }
    notes = []
    if len(held) > MAX_HELD:
        notes.append(f"{len(held) - MAX_HELD} more of their titles on the server left out.")
    if person.complete:
        reply["latest"] = [_work_entry(w, raven.base_url) for w in released[:count]]
        reply["upcoming"] = [_work_entry(w, raven.base_url) for w in upcoming[:UPCOMING_COUNT]]
    else:
        notes.append(
            "raven couldn't read their TMDB filmography just now, so only their titles on "
            "the server are known; say so if asked about anything else they made."
        )
    others = [{"name": m.name, "titles_on_server": m.titles} for m in matches[1:]]
    if others:
        reply["others_named_like_that"] = others
        if person.name.lower() != name.strip().lower():
            notes.append("Several people match; if they may have meant another, ask which.")
    if notes:
        reply["note"] = " ".join(notes)
    return Shown(reply, tuple(_held_title(w, raven.base_url) for w in held[:MAX_CARDS]))
