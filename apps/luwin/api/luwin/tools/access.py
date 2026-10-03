"""Access changes a friend asks for: another library, or 4K, decided by the admin.

`request_access` changes nothing. It checks the ask makes sense (the library
is on the server and isn't private, the friend doesn't have it already, and
it's on a server they're shared) and puts it in the admin's approval queue,
once per friend and change. The admin's Approve runs `decide_access`
(button-only, and destructive, since it changes a share), which adds the
library, or every 4K library, to the friend's plex.tv share on each server
they're shared that holds it (`maester/clients/plextv.py`). Their other
libraries and their Wizarr expiry are left alone. 4K also gives them the
trusted tier, which is what lets them request 4K (and ask for invites): the
trusted Discord role, and a stored override when no role is configured or
an override would outrank the role. A server they
aren't shared at all takes an invite, not a change, so that's the admin's.

The friend is found on plex.tv by the email their link recorded, never by a
username (a Seerr user without a Plex account chooses their own). Private libraries (`PRIVATE_LIBRARIES`) are never added, and a
friend asking for one hears there's no such library.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from maester.access import is_4k, same_library, title_of
from maester.agent.tools import Approval, Result, Tier, ToolContext, tool
from maester.clients.plextv import OwnedServer, PlexTv, Section, Share
from maester.config import Access
from maester.notify import DirectMessage, RoleChange

NOT_SET_UP = "Access changes aren't set up on this server (no Plex token), so ask the admin."
# A note the admin reads in the approval post; the rest is cut.
NOTE_MAX = 500


@dataclass(frozen=True)
class Shared:
    """A friend's share of one server, with the libraries on that server."""

    server: OwnedServer
    share: Share
    sections: tuple[Section, ...]


@dataclass(frozen=True)
class Standing:
    """Where a friend stands: their shares, and every shareable library on any server."""

    shared: tuple[Shared, ...]
    everywhere: tuple[Section, ...]


async def where_shared(plextv: PlexTv, access: Access, email: str | None) -> Standing:
    """The friend's shares on every server, and every library that could be shared."""
    servers = await plextv.servers()
    read = await asyncio.gather(
        *(
            asyncio.gather(plextv.sections(s.machine_id), plextv.shares(s.machine_id))
            for s in servers
        )
    )
    shared: list[Shared] = []
    everywhere: list[Section] = []
    for server, (sections, shares) in zip(servers, read, strict=True):
        usable = tuple(s for s in sections if not access.is_private(s.title))
        everywhere += usable
        share = next((s for s in shares if s.is_for(email)), None)
        if share is not None:
            shared.append(Shared(server, share, usable))
    return Standing(tuple(shared), tuple(everywhere))


def wanted(shared: Shared, change: str, library: str) -> list[Section]:
    """The libraries on this server the change is about."""
    if change == "4k":
        return [s for s in shared.sections if is_4k(s.title)]
    return [s for s in shared.sections if same_library(library, s.title)]


def missing(shared: Shared, sections: list[Section]) -> list[Section]:
    """Those the friend doesn't have yet on this server."""
    if shared.share.all_libraries:
        return []
    return [s for s in sections if s.id not in shared.share.section_ids]


def email_of(ctx: ToolContext, discord_id: str) -> str | None:
    """The email a friend's link recorded, which finds their Plex account's share."""
    row = ctx.store.get_user(discord_id)
    return row.plex_email if row else None


@tool(
    "request_access",
    "Ask the admin for more access: another library (change=library, naming it) or 4K "
    "(change=4k: the 4K libraries, and 4K requests). Nothing changes until the admin "
    "approves; the user gets a DM then. Refuses when they have it already, or when the "
    "library isn't on the server.",
    {
        "type": "object",
        "properties": {
            "change": {"type": "string", "enum": ["library", "4k"]},
            "library": {"type": "string", "description": "The library, for change=library."},
            "note": {"type": "string", "description": "Anything the admin should know."},
        },
        "required": ["change"],
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
)
async def request_access(
    ctx: ToolContext, change: str, library: str = "", note: str = ""
) -> Result:
    plextv = ctx.services.plextv
    if plextv is None:
        return Result.refusal(NOT_SET_UP)
    who = ctx.linked_user().name
    library = " ".join(library.split())
    if change == "library" and not library:
        return Result.refusal("Say which library.")
    stands = await where_shared(plextv, ctx.settings.access, email_of(ctx, ctx.user_id))
    if not stands.shared:
        return Result.refusal(
            "Your Plex account isn't shared any server yet, so there's nothing to add to; "
            "ask the admin for an invite."
        )
    if change == "library":
        named = next((s for s in stands.everywhere if same_library(library, s.title)), None)
        if named is None:
            return Result.refusal(f"There's no library called {library} on the server.")
        title = title_of(named.title)
        on_theirs = [s for s in stands.shared if wanted(s, change, title)]
        if not on_theirs:
            return Result.refusal(
                f"{title} is on a server you aren't shared yet; that takes an invite, so ask "
                "the admin."
            )
        if not any(missing(s, wanted(s, change, title)) for s in on_theirs):
            return Result.refusal(f"You already have {title}.")
        what, summary = f"the {title} library", f"{title} for {who}"
    else:
        title = "4K"
        gaps = any(missing(s, wanted(s, change, "")) for s in stands.shared)
        if ctx.tier >= Tier.TRUSTED and not gaps:
            return Result.refusal("You already have 4K: ask me for any title in 4K.")
        what = (
            "4K: the trusted tier (4K requests, and asking for invites for others) and the 4K "
            "libraries"
        )
        summary = f"4K for {who}"
    note = note.strip()[:NOTE_MAX]
    notice = f"{who} asks for {what}" + (f": {note}" if note else ".")
    return Result(
        {"asked": True, "change": change, "library": title if change == "library" else None},
        approval=Approval(
            notice=notice,
            summary=summary,
            decide="decide_access",
            args={"change": change, "library": title, "requester": ctx.user_id},
            subject=f"access:{ctx.user_id}:{change}:{title.lower()}",
        ),
    )


@tool(
    "decide_access",
    "The admin's decision on a friend's ask for another library or for 4K.",
    {
        "type": "object",
        "properties": {
            "change": {"type": "string", "enum": ["library", "4k"]},
            "library": {"type": "string"},
            "requester": {"type": "string", "description": "The friend's Discord id."},
            "approved": {"type": "boolean"},
        },
        "required": ["change", "library", "requester", "approved"],
        "additionalProperties": False,
    },
    tier=Tier.ADMIN,
    destructive=True,
    button_only=True,
)
async def decide_access(
    ctx: ToolContext, change: str, library: str, requester: str, approved: bool
) -> Result:
    """Add the libraries to their shares (and the trusted role, for 4K), or tell them no.

    Safe to run again: what they have already isn't added twice.
    """
    what = "4K" if change == "4k" else library
    if not approved:
        dm = f"The admin didn't add {what} to your access for now."
        return Result(
            f"Left {what} off for {ctx.name_of(requester)}.", (DirectMessage(requester, dm),)
        )
    plextv = ctx.services.plextv
    if plextv is None:
        return Result.refusal(NOT_SET_UP)
    name = ctx.link_of(requester).name
    stands = await where_shared(plextv, ctx.settings.access, email_of(ctx, requester))
    added: list[tuple[str, str]] = []  # (server, library)
    had = False
    for shared in stands.shared:
        about = wanted(shared, change, library)
        had = had or bool(about)
        if new := missing(shared, about):
            ids = sorted(shared.share.section_ids | {s.id for s in new})
            await plextv.set_sections(shared.share, ids)
            added += [(shared.server.name, s.title) for s in new]
    notices: list[Any] = []
    if change == "library":
        if not had:
            snag = (
                f"The admin said yes to {library}, but it's on a server you aren't shared yet, "
                "which takes an invite; the admin will sort it out."
            )
            return Result.refusal(
                f"{name} isn't shared a server with {library}; that takes an invite in Wizarr.",
                DirectMessage(requester, snag),
            )
        dm = (
            f"The admin added {library} to your Plex access. It shows up in the Plex app in a "
            "few minutes (restart the app if it doesn't)."
        )
    else:
        notices, tier_note = make_trusted(ctx, requester)
        shows = " The 4K libraries show up in the Plex app in a few minutes." if added else ""
        dm = f"The admin approved 4K for you: ask me for any title in 4K now.{shows}"
    notices.append(DirectMessage(requester, dm))
    done = ", ".join(f"{title} on {server}" for server, title in added) or "nothing new to share"
    extra = tier_note if change == "4k" else ""
    return Result(f"Added {done} for {name}{extra}.", tuple(notices))


def make_trusted(ctx: ToolContext, discord_id: str) -> tuple[list[Any], str]:
    """Put a friend on the trusted tier: the trusted Discord role when one is configured,
    and the stored override when there's no role, or one that would outrank it."""
    role = ctx.settings.discord_role_trusted
    row = ctx.store.get_user(discord_id)
    override = Tier.parse(row.tier_override) if row and row.tier_override else None
    notices: list[Any] = []
    notes = []
    if role:
        notices.append(RoleChange(discord_id, role, why="4K approved in maester"))
        notes.append("the trusted role")
    if not role or (override is not None and override < Tier.TRUSTED):
        ctx.store.upsert_user(discord_id, tier_override="trusted")
        notes.append("a trusted tier override")
    return notices, f", with {' and '.join(notes)}"
