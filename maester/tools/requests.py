"""Requests through Seerr, made as the friend who asked.

`request_media` asks for the standard (1080p) copy. `request_media_4k` is a
trusted-tier tool the friend tier never sees. When Seerr leaves either
request pending, it goes to the admin with Approve/Deny buttons
(`maester/approvals.py`, shared with Seerr's MEDIA_PENDING webhook so each
request is asked about once), and the press runs `decide_request`, a
button-only admin tool that approves or declines it in Seerr and tells the
requester. For shows, seasons already on the server or already requested
are left out and reported, counted the way Seerr counts them.

A 4K request is held back when the volume Seerr's 4K server puts it on is
past `STORAGE_PAUSE_4K_PERCENT` full, or its space can't be read: nothing
goes to Seerr, the friend is told why, and the admin's Approve runs
`decide_4k_over_storage`, which requests it as the friend, approved. When nothing is requested
(Seerr's refusals: quota, permission, duplicates; or nothing left to ask
for), the tool refuses (`Result.refusal`) with one sentence to relay.

A friend who wants an English dub gets the configured dub tag added to the
request (Seerr stores it on the request and hands it to Sonarr or Radarr,
where a release profile can prefer dual-audio releases), and the configured
dual-audio quality profile when that server has one.

`follow_show` is the one arr write here: it monitors a show in the Sonarr
holding its standard copy (`maester/library.py`) so future seasons
download as they air, and only on the host the caller names when that host
really is the owner.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from typing import Any

from maester.agent.tools import Approval, Result, Tier, ToolContext, tool
from maester.approvals import decision_dm, request_approval, request_subject
from maester.clients import ClientError, Services
from maester.clients.seerr import (
    ArrServer,
    MediaDetails,
    MediaRequest,
    MediaStatus,
    Refusal,
    RequestRefused,
    RequestStatus,
    Routing,
    Seerr,
)
from maester.config import Settings
from maester.library import ARR_NAMES, Library, NotLocated, OwnerUnknown, show_owner_on
from maester.media import version_label
from maester.notify import DirectMessage
from maester.storage import Space, volumes_of
from maester.store import LinkedUser

# A 4K copy runs roughly four to six times the size of a 1080p encode.
UHD_SIZE_FACTOR = (4, 6)

REFUSALS = {
    Refusal.PERMISSION: "Seerr doesn't allow this account to make that kind of request; "
    "the admin can change that.",
    Refusal.DUPLICATE: "It has already been requested.",
    Refusal.NO_SEASONS: "Every season asked for is already on the server or requested.",
    Refusal.BLOCKLISTED: "That title is blocklisted on this server.",
}

REQUEST_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "tmdb_id": {"type": "integer", "description": "The TMDB id from search_media."},
        "media_type": {"type": "string", "enum": ["movie", "tv"]},
        "seasons": {
            "type": "array",
            "items": {"type": "integer"},
            "description": 'TV only: the season numbers asked for ("season 2 and 3" is [2, 3]). '
            "Omit for every season; [] requests none, for following future seasons only.",
        },
        "latest_season": {
            "type": "boolean",
            "description": 'TV only: just the newest season ("just the latest").',
        },
        "english_dub": {
            "type": "boolean",
            "description": "The user wants English audio (anime): prefer dual-audio releases.",
        },
    },
    "required": ["tmdb_id", "media_type"],
    "additionalProperties": False,
}


class NotRequested(Exception):
    """Nothing was sent to Seerr; the message says why, in words to relay."""


@dataclass(frozen=True)
class SeasonPlan:
    request: list[int]
    # Seasons asked for but not requested, with where each already stands.
    left_out: dict[int, str]


def plan_seasons(
    details: MediaDetails, asked: list[int] | None, latest: bool, is_4k: bool
) -> SeasonPlan:
    """Which asked-for seasons to request: those Seerr would not already count as present."""
    if asked is not None and latest:
        raise NotRequested("pass seasons or latest_season, not both")
    known = {s.number: s for s in details.seasons}
    if latest:
        wanted = [max(known)] if known else []
    elif asked is None:
        wanted = sorted(known)
    else:
        missing = sorted(set(asked) - set(known))
        if missing:
            raise NotRequested(f"{details.display} has no season {missing}; it has {sorted(known)}")
        wanted = sorted(set(asked))
    statuses = {n: known[n].status_for(is_4k) for n in wanted}
    return SeasonPlan(
        request=[n for n, status in statuses.items() if status.requestable],
        left_out={n: status.label for n, status in statuses.items() if not status.requestable},
    )


@dataclass(frozen=True)
class Submitted:
    request: MediaRequest
    reply: dict[str, Any]


async def dub_routing(
    seerr: Seerr, settings: Settings, details: MediaDetails, is_4k: bool
) -> tuple[Routing | None, dict[str, Any]]:
    """Where a dub request goes: Seerr's own tags plus the dub tag, and the dub profile."""
    kind = "radarr" if details.media_type == "movie" else "sonarr"
    servers = await seerr.servers(kind)
    server = next((s for s in servers if s.is_4k == is_4k and s.is_default), None)
    if server is None:
        return None, {"dub": "Seerr has no default server for this; requested without the dub tag."}
    options = await seerr.server_options(kind, server.id)
    tag = options.tag(settings.dub_tag)
    if tag is None:
        return None, {
            "dub": f"{server.name} has no '{settings.dub_tag}' tag, so the dub preference "
            "couldn't be attached; the admin can add the tag."
        }
    # Request tags replace the ones Seerr would apply, so keep those.
    base = options.anime_tags if details.seerr_anime else options.default_tags
    tags = tuple(dict.fromkeys((*base, tag.id)))
    profile = options.profile(settings.dub_profile) if settings.dub_profile else None
    routing = Routing(server.id, tags, profile.id if profile else None)
    return routing, {"dub": {"tag": tag.name, "profile": profile.name if profile else None}}


@dataclass(frozen=True)
class Planned:
    """What a request would ask Seerr for: a show's seasons (None for a movie), and the reply."""

    seasons: list[int] | None
    reply: dict[str, Any]


def plan_request(
    details: MediaDetails, seasons: list[int] | None, latest_season: bool, *, is_4k: bool
) -> Planned:
    """What to request, leaving out what is already there; `NotRequested` when nothing is left."""
    version = version_label(is_4k)
    reply: dict[str, Any] = {"title": details.display, "version": version}
    nothing = f"Nothing was requested for {details.display} in {version}"
    if details.media_type == "tv":
        plan = plan_seasons(details, seasons, latest_season, is_4k)
        if plan.left_out:
            reply["left_out"] = [{"season": n, "status": s} for n, s in plan.left_out.items()]
        if not plan.request:
            there = "; ".join(f"season {n} is {s}" for n, s in plan.left_out.items())
            why = (
                f"{REFUSALS[Refusal.NO_SEASONS]} ({there})"
                if there
                else "no seasons were asked for."
            )
            raise NotRequested(f"{nothing}: {why}")
        return Planned(plan.request, reply)
    if seasons is not None or latest_season:
        raise NotRequested("seasons are for TV shows only")
    if not (status := details.status_for(is_4k)).requestable:
        raise NotRequested(f"{nothing}: it's {status.label}.")
    return Planned(None, reply)


async def submit(
    ctx: ToolContext,
    details: MediaDetails,
    planned: Planned,
    *,
    is_4k: bool,
    english_dub: bool = False,
    user: LinkedUser | None = None,
) -> Submitted:
    """Request what's planned in Seerr as `user` (the caller, unless named).

    `NotRequested` says why Seerr didn't take it.
    """
    user = user or ctx.linked_user()
    seerr = ctx.services.seerr
    reply = dict(planned.reply)
    routing = None
    if english_dub:
        routing, dub = await dub_routing(seerr, ctx.settings, details, is_4k)
        reply.update(dub)
    try:
        request = await seerr.create_request(
            details.media_type,
            details.tmdb_id,
            as_user=user.seerr_user_id,
            is_4k=is_4k,
            seasons=planned.seasons,
            routing=routing,
        )
    except RequestRefused as refused:
        reason = await explain(seerr, user, refused, details.media_type)
        raise NotRequested(
            f"Seerr didn't take the request for {details.display}: {reason}"
        ) from refused
    return Submitted(
        request,
        {
            **reply,
            "requested": True,
            "request_id": request.id,
            "auto_approved": request.status == RequestStatus.APPROVED,
            **({"seasons": list(request.seasons)} if request.seasons else {}),
        },
    )


async def explain(seerr: Seerr, user: LinkedUser, refused: RequestRefused, media_type: str) -> str:
    if refused.reason != Refusal.QUOTA:
        return REFUSALS[refused.reason]
    quota = (await seerr.quota(user.seerr_user_id)).of(media_type)
    kind = "movie" if media_type == "movie" else "TV season"
    return (
        f"That's over this account's {kind} request quota: {quota.used} of {quota.limit} used "
        f"in the last {quota.days} days. Room frees up as older requests age out."
    )


async def standard_copy_bytes(services: Services, details: MediaDetails) -> int | None:
    """Size of the 1080p copy on the server, or None when no arr has it."""
    owner = await (await Library.load(services)).owner(details, is_4k=False)
    if owner is None:
        return None
    return sum(f.size_bytes for f in await owner.files()) or None


async def size_tradeoff(services: Services, details: MediaDetails) -> dict[str, Any]:
    """What a 1080p copy already takes, so the 4K request can be weighed against it."""
    if details.status not in (MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE):
        return {}
    tradeoff: dict[str, Any] = {"standard_copy": details.status.label}
    try:
        size = await standard_copy_bytes(services, details)
    except (OwnerUnknown, ClientError) as exc:  # an estimate is not worth failing the request
        return {**tradeoff, "standard_copy_size": f"unknown ({exc})"}
    if size:
        gb = size / 1e9
        low, high = UHD_SIZE_FACTOR
        tradeoff["standard_copy_gb"] = round(gb, 1)
        tradeoff["estimated_4k_gb"] = f"{round(gb * low)}-{round(gb * high)}"
    return tradeoff


@tool(
    "request_media",
    "Request a movie or show in the standard (1080p) version through Seerr, as the user, so "
    "their quotas apply. For shows, pass the seasons asked for (or latest_season); seasons "
    "already on the server or requested are left out and listed in left_out. Set "
    "english_dub when they want English audio. Returns the Seerr request id and whether it "
    "was approved automatically; when nothing was requested, it refuses and says why.",
    REQUEST_SCHEMA,
    tier=Tier.FRIEND,
)
async def request_media(
    ctx: ToolContext,
    tmdb_id: int,
    media_type: str,
    seasons: list[int] | None = None,
    latest_season: bool = False,
    english_dub: bool = False,
) -> dict[str, Any] | Result:
    details = await ctx.services.seerr.media_details(media_type, tmdb_id)
    try:
        planned = plan_request(details, seasons, latest_season, is_4k=False)
        submitted = await submit(ctx, details, planned, is_4k=False, english_dub=english_dub)
    except NotRequested as why:
        return Result.refusal(str(why))
    return awaiting_admin(ctx, submitted, details)


def awaiting_admin(
    ctx: ToolContext, submitted: Submitted, details: MediaDetails, note: str = ""
) -> dict[str, Any] | Result:
    """The reply; when Seerr left the request pending, the admin is asked too."""
    if submitted.request.status != RequestStatus.PENDING:
        return submitted.reply
    approval = request_approval(
        submitted.request,
        details.display,
        requester=ctx.user_id,
        who=ctx.linked_user().name,
        note=note,
    )
    return Result(submitted.reply, approval=approval)


@tool(
    "decide_request",
    "The admin's decision on a request Seerr left pending: approve or decline it in Seerr.",
    {
        "type": "object",
        "properties": {
            "request_id": {"type": "integer", "description": "The Seerr request id."},
            "title": {"type": "string"},
            "version": {"type": "string", "enum": ["1080p", "4K"]},
            "requester": {
                "type": "string",
                "description": "The requester's Discord id; empty when they aren't linked here.",
            },
            "approved": {"type": "boolean"},
        },
        "required": ["request_id", "title", "version", "requester", "approved"],
        "additionalProperties": False,
    },
    tier=Tier.ADMIN,
    button_only=True,
)
async def decide_request(
    ctx: ToolContext, request_id: int, title: str, version: str, requester: str, approved: bool
) -> Result:
    """Approve or decline the request in Seerr, then tell the requester.

    Safe to run again: when Seerr already shows this decision (an earlier
    press went through before failing), the requester is still told.
    """
    seerr = ctx.services.seerr
    wanted = RequestStatus.APPROVED if approved else RequestStatus.DECLINED
    current = (await seerr.get_request(request_id)).status
    if current == RequestStatus.PENDING:
        await (seerr.approve_request if approved else seerr.decline_request)(request_id)
    elif current != wanted:
        return Result.refusal(
            f"Seerr request #{request_id} ({title} in {version}) was already {current.label} in "
            "Seerr; nothing changed."
        )
    verb = "Approved" if approved else "Declined"
    dm = decision_dm(title, version, approved)
    told = (DirectMessage(requester, dm),) if requester else ()
    return Result(f"{verb} {title} in {version} in Seerr (request #{request_id}).", told)


@tool(
    "request_media_4k",
    "Request the 4K version of a movie or show through Seerr, as the user. Seerr sends it to "
    "its 4K server; unless Seerr approves it automatically, it then waits for the admin. "
    "When the 4K storage is nearly full it isn't sent yet and waits for the admin; the "
    "result's storage says why. "
    "When a 1080p copy is already on the server the result gives its size and the 4K "
    "estimate, so you can explain the storage trade-off.",
    REQUEST_SCHEMA,
    tier=Tier.TRUSTED,
)
async def request_media_4k(
    ctx: ToolContext,
    tmdb_id: int,
    media_type: str,
    seasons: list[int] | None = None,
    latest_season: bool = False,
    english_dub: bool = False,
) -> dict[str, Any] | Result:
    seerr = ctx.services.seerr
    kind = "radarr" if media_type == "movie" else "sonarr"
    uhd = [s for s in await seerr.servers(kind) if s.is_4k]
    if not uhd:
        return Result.refusal("4K requests aren't set up on this server.")
    details = await seerr.media_details(media_type, tmdb_id)
    try:
        planned = plan_request(details, seasons, latest_season, is_4k=True)
    except NotRequested as why:
        return Result.refusal(str(why))
    # Measured before the request exists, so a failed lookup cannot orphan it.
    tradeoff = await size_tradeoff(ctx.services, details)
    if full := await no_room_for_4k(ctx, details, uhd):
        return held_for_room(ctx, details, planned, tradeoff, full, english_dub)
    try:
        submitted = await submit(ctx, details, planned, is_4k=True, english_dub=english_dub)
    except NotRequested as why:
        return Result.refusal(str(why))
    submitted = replace(submitted, reply={**submitted.reply, **tradeoff})
    return awaiting_admin(ctx, submitted, details, size_note(tradeoff))


def size_note(tradeoff: dict[str, Any]) -> str:
    if "standard_copy_gb" not in tradeoff:
        return ""
    return (
        f"The 1080p copy is {tradeoff['standard_copy_gb']} GB; 4K would be about "
        f"{tradeoff['estimated_4k_gb']} GB."
    )


async def no_room_for_4k(
    ctx: ToolContext, details: MediaDetails, uhd: list[ArrServer]
) -> str | None:
    """Why a 4K request must wait for the admin because of space; None when there's room.

    The volume is the one Seerr's 4K server puts requests on (its root folder,
    or the arr's only one). Space that can't be read counts as no room: a
    download that wedges a NAS costs more than a request that waits.
    """
    limit = ctx.settings.guardrails.storage_pause_4k_percent
    server = next((s for s in uhd if s.is_default), uhd[0])
    try:
        host = Library(ctx.services, {}).host_of(details.media_type, server)
        arr = Library(ctx.services, {}).clients(details.media_type)[host]
        roots, disks = await asyncio.gather(arr.root_folders(), arr.disk_space())
    except (OwnerUnknown, ClientError) as exc:
        return f"the 4K server's free space couldn't be read ({exc})"
    root = server.root_folder or (roots[0].path if len(roots) == 1 else "")
    if not root:
        return f"Seerr names no root folder for {server.name}, so its free space can't be told"
    volume = Space(tuple(volumes_of(host, roots, disks)), {}).holding(host, root)
    if volume is None:
        return f"{ARR_NAMES[details.media_type]} on {host} reports no free space for {root}"
    if volume.used_percent < limit:
        return None
    return (
        f"{volume.path} on {host}, where 4K {details.media_type}s go, is {volume.used_percent:g}% "
        f"full (the limit is {limit}%)"
    )


def room_subject(requester: str, details: MediaDetails) -> str:
    return f"4k-room:{requester}:{details.media_type}:{details.tmdb_id}"


def held_for_room(
    ctx: ToolContext,
    details: MediaDetails,
    planned: Planned,
    tradeoff: dict[str, Any],
    full: str,
    english_dub: bool,
) -> Result:
    """Nothing goes to Seerr yet: the admin decides, and Approve requests it as the friend."""
    who = ctx.linked_user().name
    reply = {
        **planned.reply,
        **tradeoff,
        "requested": False,
        "storage": f"{full[0].upper()}{full[1:]}, so 4K requests wait for the admin's approval "
        "for now; it's requested once they approve.",
    }
    notice = (
        f"{who} asks for {details.display} in 4K, but {full}. Approve to request it anyway. "
        f"{size_note(tradeoff)}"
    ).strip()
    return Result(
        reply,
        approval=Approval(
            notice=notice,
            summary=f"4K {details.display} for {who}, over the storage limit",
            decide="decide_4k_over_storage",
            args={
                "tmdb_id": details.tmdb_id,
                "media_type": details.media_type,
                "seasons": planned.seasons,
                "english_dub": english_dub,
                "title": details.display,
                "requester": ctx.user_id,
            },
            subject=room_subject(ctx.user_id, details),
        ),
    )


@tool(
    "decide_4k_over_storage",
    "The admin's decision on a 4K request held because its volume is nearly full.",
    {
        "type": "object",
        "properties": {
            "tmdb_id": {"type": "integer"},
            "media_type": {"type": "string", "enum": ["movie", "tv"]},
            "seasons": {"type": "array", "items": {"type": "integer"}},
            "english_dub": {"type": "boolean"},
            "title": {"type": "string"},
            "requester": {"type": "string", "description": "The friend's Discord id."},
            "approved": {"type": "boolean"},
        },
        "required": ["tmdb_id", "media_type", "english_dub", "title", "requester", "approved"],
        "additionalProperties": False,
    },
    tier=Tier.ADMIN,
    button_only=True,
)
async def decide_4k_over_storage(
    ctx: ToolContext,
    tmdb_id: int,
    media_type: str,
    english_dub: bool,
    title: str,
    requester: str,
    approved: bool,
    seasons: list[int] | None = None,
) -> Result:
    """Request it in Seerr as the friend, approved, or tell them it's held off.

    Safe to run again: a request that went through the first time is already
    there, so the second run refuses rather than asking twice.
    """
    if not approved:
        dm = (
            f"The admin held off on {title} in 4K for now: the server's 4K storage is nearly "
            "full. You can still ask for the regular version."
        )
        return Result(f"Held off on {title} in 4K.", (DirectMessage(requester, dm),))
    user = ctx.link_of(requester)
    seerr = ctx.services.seerr
    details = await seerr.media_details(media_type, tmdb_id)
    try:
        # The seasons still missing now: something may have landed while it waited.
        planned = plan_request(details, seasons, False, is_4k=True)
        submitted = await submit(
            ctx, details, planned, is_4k=True, english_dub=english_dub, user=user
        )
    except NotRequested as why:
        return Result.refusal(str(why))
    request = submitted.request
    if request.status == RequestStatus.PENDING:  # the admin just approved it here
        await seerr.approve_request(request.id)
    # Seerr's webhook may have asked about the new request meanwhile; this settles it.
    if raised := ctx.store.pending_about(request_subject(request.id)):
        ctx.store.decide_pending(raised.id, "approved", ctx.user_id)
    dm = decision_dm(title, "4K", approved=True)
    return Result(
        f"Requested {title} in 4K for {user.name} and approved it in Seerr (request #{request.id}).",
        (DirectMessage(requester, dm),),
    )


@tool(
    "follow_show",
    "Monitor a show in the Sonarr that owns it so future seasons download as they air "
    '("follow future seasons"). host is the owning Sonarr host that check_availability '
    "reports; the show must already be in Sonarr, which happens once a request is approved.",
    {
        "type": "object",
        "properties": {
            "tmdb_id": {"type": "integer", "description": "The show's TMDB id."},
            "host": {"type": "string", "description": "The Sonarr host that owns the show."},
        },
        "required": ["tmdb_id", "host"],
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
    host_param="host",
)
async def follow_show(ctx: ToolContext, tmdb_id: int, host: str) -> dict[str, Any] | Result:
    details = await ctx.services.seerr.media_details("tv", tmdb_id)
    try:
        owner = await show_owner_on(ctx.services, details, host)
    except NotLocated as exc:
        return Result.refusal(str(exc))
    await owner.follow()
    return {"followed": True, "title": details.display, "host": owner.host}
