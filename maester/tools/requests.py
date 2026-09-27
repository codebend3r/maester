"""Requests through Seerr, made as the friend who asked.

`request_media` asks for the standard (1080p) copy. `request_media_4k` is a
trusted-tier tool the friend tier never sees; when Seerr leaves a 4K request
pending, it goes to the admin with Approve/Deny buttons, and the tool's
`settle` approves or declines it in Seerr and tells the requester. For
shows, seasons already on the server or already requested are left out and
reported, counted the way Seerr counts them. Seerr's refusals (quota,
permission, duplicates) come back as sentences to relay, not as errors.

A friend who wants an English dub gets the configured dub tag added to the
request (Seerr stores it on the request and hands it to Sonarr or Radarr,
where a release profile can prefer dual-audio releases), and the configured
dual-audio quality profile when that server has one.

`follow_show` is the one arr write here: it monitors a show in the Sonarr
that owns it so future seasons download as they air, and only on the host
the caller names when that host really is the owner.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from maester.agent.tools import (
    Approval,
    ForAdmin,
    LinkedUser,
    Settled,
    Tier,
    ToolContext,
    tool,
)
from maester.clients import ClientError, Services
from maester.clients.seerr import (
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
from maester.library import AmbiguousOwner, movie_owner, series_owner
from maester.notify import Notice
from maester.store import PendingAction

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
        raise ValueError("pass seasons or latest_season, not both")
    known = {s.number: s for s in details.seasons}
    if latest:
        wanted = [max(known)] if known else []
    elif asked is None:
        wanted = sorted(known)
    else:
        missing = sorted(set(asked) - set(known))
        if missing:
            raise ValueError(f"{details.display} has no season {missing}; it has {sorted(known)}")
        wanted = sorted(set(asked))
    statuses = {n: known[n].status_for(is_4k) for n in wanted}
    return SeasonPlan(
        request=[n for n, status in statuses.items() if status.requestable],
        left_out={n: status.label for n, status in statuses.items() if not status.requestable},
    )


@dataclass(frozen=True)
class Submitted:
    request: MediaRequest | None  # None when nothing was sent to Seerr
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


async def submit(
    ctx: ToolContext,
    details: MediaDetails,
    seasons: list[int] | None,
    latest_season: bool,
    *,
    is_4k: bool,
    english_dub: bool = False,
) -> Submitted:
    """Request `details` in Seerr as the caller, leaving out what is already there."""
    user = ctx.linked_user()
    seerr = ctx.services.seerr
    reply: dict[str, Any] = {"title": details.display, "version": "4K" if is_4k else "1080p"}
    wanted = None
    if details.media_type == "tv":
        plan = plan_seasons(details, seasons, latest_season, is_4k)
        if plan.left_out:
            reply["left_out"] = [{"season": n, "status": s} for n, s in plan.left_out.items()]
        if not plan.request:
            reason = REFUSALS[Refusal.NO_SEASONS] if plan.left_out else "No seasons were asked for."
            return Submitted(None, {**reply, "requested": False, "reason": reason})
        wanted = plan.request
    elif seasons is not None or latest_season:
        raise ValueError("seasons are for TV shows only")
    elif not (status := details.status_for(is_4k)).requestable:
        return Submitted(None, {**reply, "requested": False, "status": status.label})
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
            seasons=wanted,
            routing=routing,
        )
    except RequestRefused as refused:
        reason = await explain(seerr, user, refused, details.media_type)
        return Submitted(None, {**reply, "requested": False, "reason": reason})
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
    if details.media_type == "movie":
        movie = await movie_owner(services, details.tmdb_id)
        if movie is None:
            return None
        files = await services.radarr[movie.host].movie_files(movie.item.id)
    else:
        show = await series_owner(services, details.tvdb_id) if details.tvdb_id else None
        if show is None:
            return None
        files = await services.sonarr[show.host].episode_files(show.item.id)
    return sum(f.size_bytes for f in files) or None


async def size_tradeoff(services: Services, details: MediaDetails) -> dict[str, Any]:
    """What a 1080p copy already takes, so the 4K request can be weighed against it."""
    if details.status not in (MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE):
        return {}
    tradeoff: dict[str, Any] = {"standard_copy": details.status.label}
    try:
        size = await standard_copy_bytes(services, details)
    except (AmbiguousOwner, ClientError) as exc:  # an estimate is not worth failing the request
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
    "was approved automatically, or why Seerr refused.",
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
) -> dict[str, Any]:
    details = await ctx.services.seerr.media_details(media_type, tmdb_id)
    submitted = await submit(
        ctx, details, seasons, latest_season, is_4k=False, english_dub=english_dub
    )
    return submitted.reply


async def settle_4k(ctx: ToolContext, pending: PendingAction, approved: bool) -> Settled:
    """Approve or decline the pending 4K request in Seerr, then tell the requester."""
    seerr = ctx.services.seerr
    request_id, title = pending.payload["request_id"], pending.payload["title"]
    current = await seerr.get_request(request_id)
    if current.status != RequestStatus.PENDING:
        return Settled(
            f"Seerr request #{request_id} ({title} in 4K) was already "
            f"{current.status.label} in Seerr; nothing changed."
        )
    if approved:
        await seerr.approve_request(request_id)
        verb = "Approved"
        dm = f"The admin approved {title} in 4K. It's on its way; I'll message you when it's ready."
    else:
        await seerr.decline_request(request_id)
        verb = "Declined"
        dm = f"The admin declined {title} in 4K. You can still ask for the regular version."
    return Settled(
        f"{verb} in Seerr: {pending.summary} (request #{request_id}).",
        (Notice(dm, to=pending.requester),),
    )


@tool(
    "request_media_4k",
    "Request the 4K version of a movie or show through Seerr, as the user. Seerr sends it to "
    "its 4K server; unless Seerr approves it automatically, it then waits for the admin. "
    "When a 1080p copy is already on the server the result gives its size and the 4K "
    "estimate, so you can explain the storage trade-off.",
    REQUEST_SCHEMA,
    tier=Tier.TRUSTED,
    settle=settle_4k,
)
async def request_media_4k(
    ctx: ToolContext,
    tmdb_id: int,
    media_type: str,
    seasons: list[int] | None = None,
    latest_season: bool = False,
    english_dub: bool = False,
) -> dict[str, Any] | ForAdmin:
    seerr = ctx.services.seerr
    if not any(
        s.is_4k for s in await seerr.servers("radarr" if media_type == "movie" else "sonarr")
    ):
        return {"requested": False, "reason": "4K requests aren't set up on this server."}
    details = await seerr.media_details(media_type, tmdb_id)
    # Measured before the request exists, so a failed lookup cannot orphan it.
    tradeoff = await size_tradeoff(ctx.services, details)
    submitted = await submit(
        ctx, details, seasons, latest_season, is_4k=True, english_dub=english_dub
    )
    reply = {**submitted.reply, **tradeoff}
    request = submitted.request
    if request is None or request.status != RequestStatus.PENDING:
        return reply
    who = ctx.linked_user().name
    notice = f"{who} asks for {details.display} in 4K (Seerr request #{request.id})."
    if "standard_copy_gb" in tradeoff:
        notice += (
            f" The 1080p copy is {tradeoff['standard_copy_gb']} GB;"
            f" 4K would be about {tradeoff['estimated_4k_gb']} GB."
        )
    return ForAdmin(
        reply,
        notice,
        Approval(
            summary=f"4K {details.display} for {who}",
            payload={"request_id": request.id, "title": details.display},
        ),
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
async def follow_show(ctx: ToolContext, tmdb_id: int, host: str) -> dict[str, Any]:
    details = await ctx.services.seerr.media_details("tv", tmdb_id)
    owner = await series_owner(ctx.services, details.tvdb_id) if details.tvdb_id else None
    if owner is None:
        return {
            "followed": False,
            "reason": f"{details.display} isn't in Sonarr yet; it's added once a request for "
            "it is approved.",
        }
    if owner.host != host.lower():
        return {
            "followed": False,
            "reason": f"{details.display} is on the Sonarr on {owner.host}, not {host}.",
        }
    await ctx.services.sonarr[owner.host].follow(owner.item.id)
    return {"followed": True, "title": details.display, "host": owner.host}
