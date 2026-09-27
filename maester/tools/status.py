"""Where a friend's requests are: Seerr's state merged with the download.

For each open Seerr request, the title's owning Radarr or Sonarr (found the
way `maester/library.py` finds owners, never guessed) says whether it is in
the download queue. Queue entries are matched to that host's SABnzbd by
download id, and SABnzbd's live percent and time left win over the arr's.
The request's percent is weighted by size across its entries (a season is
many), its ETA is the slowest entry. Stalls come from the arr's status
messages or SABnzbd's state; with nothing queued, a failed last download is
reported with the reason from the arr's history, or SABnzbd's when the arr
recorded none.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

from maester.agent.tools import Tier, ToolContext, tool
from maester.clients import Services
from maester.clients.arr import QueueItem
from maester.clients.radarr import Radarr
from maester.clients.sabnzbd import Download, Sabnzbd
from maester.clients.seerr import MediaDetails, MediaRequest, RequestStatus
from maester.clients.sonarr import Sonarr
from maester.library import AmbiguousOwner, movie_owner, series_owner

OPEN_REQUESTS = 20
# SABnzbd writes "0:03:10" (or "1:02:03:04" with days); the arrs write a
# .NET TimeSpan, "00:03:10" or "1.02:03:04".
_TIME_LEFT = re.compile(r"^(?:(\d+)[.:])?(\d+):(\d{2}):(\d{2})(?:\.\d+)?$")
_SAB_STALLED = {"paused", "failed"}


def seconds_left(text: str | None) -> int | None:
    match = _TIME_LEFT.match(text or "")
    if match is None:
        return None
    days, hours, minutes, secs = (int(g or 0) for g in match.groups())
    return ((days * 24 + hours) * 60 + minutes) * 60 + secs


def humanized(seconds: int) -> str:
    minutes = max(1, round(seconds / 60))
    if minutes < 60:
        return f"about {minutes} min"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"about {hours} h {minutes} min" if minutes else f"about {hours} h"
    days, hours = divmod(hours, 24)
    return f"about {days} d {hours} h" if hours else f"about {days} d"


def merged_progress(queue: list[QueueItem], slots: dict[str, Download]) -> dict[str, Any]:
    total = sum(q.size_bytes for q in queue)
    done, etas, problems = 0.0, [], []
    for q in queue:
        slot = slots.get(q.download_id or "")
        percent = slot.percent if slot else q.percent
        done += q.size_bytes * percent / 100
        if (left := seconds_left(slot.time_left if slot else q.time_left)) is not None:
            etas.append(left)
        if q.tracked_status != "ok" or q.error_messages:
            problems.append(f"{q.title}: {'; '.join(q.error_messages) or q.tracked_status}")
        if slot and slot.status.lower() in _SAB_STALLED:
            problems.append(f"{q.title}: {slot.status.lower()} in SABnzbd")
    progress: dict[str, Any] = {
        "percent": round(100 * done / total, 1) if total else 0.0,
        "eta": humanized(max(etas)) if etas else None,
    }
    if problems:
        progress["stalled"] = problems
    return progress


async def last_failure(arr: Radarr | Sonarr, sab: Sabnzbd | None, media_id: int) -> dict[str, Any]:
    """Nothing is queued: say whether the last download failed, and why."""
    events = await arr.history(media_id)
    if not events or events[0].event_type != "downloadFailed":
        return {"download": "nothing downloading right now; waiting for a release to grab"}
    reason = events[0].message
    if not reason and sab is not None:
        failed = {d.nzo_id: d for d in await sab.history()}.get(events[0].download_id or "")
        reason = failed.fail_message if failed and failed.fail_message else ""
    return {"failed": f"the last download failed: {reason or 'no reason recorded'}"}


async def download_progress(services: Services, details: MediaDetails) -> dict[str, Any]:
    movie = details.media_type == "movie"
    try:
        if movie:
            owner = await movie_owner(services, details.tmdb_id)
        else:
            owner = await series_owner(services, details.tvdb_id) if details.tvdb_id else None
    except AmbiguousOwner as exc:
        return {"download": str(exc)}
    if owner is None:
        return {"download": "not sent to Radarr or Sonarr yet"}
    arr = services.radarr[owner.host] if movie else services.sonarr[owner.host]
    sab = services.sabnzbd.get(owner.host)
    queue = [q for q in await arr.queue() if q.media_id == owner.item.id]
    if not queue:
        return {"host": owner.host, **await last_failure(arr, sab, owner.item.id)}
    slots = {d.nzo_id: d for d in await sab.queue()} if sab else {}
    return {"host": owner.host, **merged_progress(queue, slots)}


async def request_row(services: Services, request: MediaRequest) -> dict[str, Any]:
    details = await services.seerr.media_details(request.media_type, request.tmdb_id)
    row: dict[str, Any] = {
        "request_id": request.id,
        "title": details.display,
        "version": "4K" if request.is_4k else "1080p",
        "request": request.status.label,
        "availability": request.media_status.label,
    }
    if request.seasons:
        row["seasons"] = list(request.seasons)
    if request.status == RequestStatus.APPROVED:
        row.update(await download_progress(services, details))
    return row


@tool(
    "request_status",
    "The user's open requests: each with its Seerr state (waiting for approval, approved, "
    "declined) and, once approved, the download from the owning host's Radarr/Sonarr queue "
    "and SABnzbd merged into a percent and ETA. Stalled or failed downloads say why.",
    {"type": "object", "properties": {}, "additionalProperties": False},
    tier=Tier.FRIEND,
)
async def request_status(ctx: ToolContext) -> dict[str, Any]:
    user = ctx.linked_user()
    requests = await ctx.services.seerr.list_requests(
        user_id=user.seerr_user_id, take=OPEN_REQUESTS, filter="unavailable"
    )
    if not requests:
        return {"requests": [], "note": "No open requests."}
    rows = await asyncio.gather(*(request_row(ctx.services, r) for r in requests))
    return {"requests": list(rows)}
