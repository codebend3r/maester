"""Where a friend's requests are: Seerr's state merged with the download.

For each open Seerr request, the title's owning Radarr or Sonarr (found the
way `maester/library.py` finds owners, never guessed) says whether it is in
the download queue. Queue entries are matched to that host's SABnzbd by
download id, and SABnzbd's live percent and time left win over the arr's.
The request's percent is weighted by size across its entries (a season is
many), its ETA is the slowest entry. Stalls come from the arr's status
messages or SABnzbd's state; with nothing queued, a failed last download is
reported with the reason from the arr's history, or SABnzbd's when the arr
recorded none. Requests Seerr failed to hand to an arr are listed too. Each
host's queues are fetched once per check, however many requests share it.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from typing import Any

from maester.agent.tools import Tier, ToolContext, tool
from maester.clients import Services
from maester.clients.arr import QueueItem
from maester.clients.radarr import Radarr
from maester.clients.sabnzbd import Download
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


class Downloads:
    """Each host's arr queue and SABnzbd queue and history, fetched at most once per check.

    Requests are checked concurrently; the first to need a host's queue
    starts the fetch and the others await the same task.
    """

    def __init__(self, services: Services):
        self.services = services
        self._fetches: dict[tuple[str, str], asyncio.Future[Any]] = {}

    def arr(self, kind: str, host: str) -> Radarr | Sonarr:
        return self.services.radarr[host] if kind == "movie" else self.services.sonarr[host]

    async def queue(self, kind: str, host: str) -> list[QueueItem]:
        return await self._once(("queue", f"{kind}:{host}"), lambda: self.arr(kind, host).queue())

    async def sab_queue(self, host: str) -> dict[str, Download]:
        sab = self.services.sabnzbd.get(host)
        return await self._once(("sab_queue", host), lambda: _by_nzo(sab.queue())) if sab else {}

    async def sab_history(self, host: str) -> dict[str, Download]:
        sab = self.services.sabnzbd.get(host)
        return (
            await self._once(("sab_history", host), lambda: _by_nzo(sab.history())) if sab else {}
        )

    def _once(
        self, key: tuple[str, str], fetch: Callable[[], Awaitable[Any]]
    ) -> asyncio.Future[Any]:
        if key not in self._fetches:
            self._fetches[key] = asyncio.ensure_future(fetch())
        return self._fetches[key]


async def _by_nzo(rows: Awaitable[list[Download]]) -> dict[str, Download]:
    return {d.nzo_id: d for d in await rows}


async def last_failure(downloads: Downloads, kind: str, host: str, media_id: int) -> dict[str, Any]:
    """Nothing is queued: say whether the last download failed, and why."""
    events = await downloads.arr(kind, host).history(media_id)
    if not events or events[0].event_type != "downloadFailed":
        return {"download": "nothing downloading right now; waiting for a release to grab"}
    reason = events[0].message
    if not reason:
        failed = (await downloads.sab_history(host)).get(events[0].download_id or "")
        reason = failed.fail_message if failed and failed.fail_message else ""
    return {"failed": f"the last download failed: {reason or 'no reason recorded'}"}


async def download_progress(downloads: Downloads, details: MediaDetails) -> dict[str, Any]:
    kind, services = details.media_type, downloads.services
    try:
        if kind == "movie":
            owner = await movie_owner(services, details.tmdb_id)
        else:
            owner = await series_owner(services, details.tvdb_id) if details.tvdb_id else None
    except AmbiguousOwner as exc:
        return {"download": str(exc)}
    if owner is None:
        return {"download": "not sent to Radarr or Sonarr yet"}
    queue = [q for q in await downloads.queue(kind, owner.host) if q.media_id == owner.item.id]
    if not queue:
        return {
            "host": owner.host,
            **await last_failure(downloads, kind, owner.host, owner.item.id),
        }
    slots = await downloads.sab_queue(owner.host)
    return {"host": owner.host, **merged_progress(queue, slots)}


async def request_row(downloads: Downloads, request: MediaRequest) -> dict[str, Any]:
    details = await downloads.services.seerr.media_details(request.media_type, request.tmdb_id)
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
        row.update(await download_progress(downloads, details))
    elif request.status == RequestStatus.FAILED:
        row["failed"] = (
            "Seerr couldn't hand it to Radarr or Sonarr; the admin can retry it in Seerr."
        )
    return row


@tool(
    "request_status",
    "The user's open requests: each with its Seerr state (waiting for approval, approved, "
    "failed) and, once approved, the download from the owning host's Radarr/Sonarr queue "
    "and SABnzbd merged into a percent and ETA. Stalled or failed downloads say why.",
    {"type": "object", "properties": {}, "additionalProperties": False},
    tier=Tier.FRIEND,
)
async def request_status(ctx: ToolContext) -> dict[str, Any]:
    user = ctx.linked_user()
    seerr = ctx.services.seerr
    # Seerr's "unavailable" filter holds pending and approved requests; failed ones are apart.
    waiting, failed = await asyncio.gather(
        *(
            seerr.list_requests(user_id=user.seerr_user_id, take=OPEN_REQUESTS, filter=f)
            for f in ("unavailable", "failed")
        )
    )
    requests = sorted({r.id: r for r in (*waiting, *failed)}.values(), key=lambda r: -r.id)
    if not requests:
        return {"requests": [], "note": "No open requests."}
    downloads = Downloads(ctx.services)
    rows = await asyncio.gather(*(request_row(downloads, r) for r in requests))
    return {"requests": list(rows)}
