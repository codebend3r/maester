"""Where a friend's requests are: Seerr's state merged with the download.

For each open Seerr request, the arr holding that request's copy (standard
or 4K, found by `maester/library.py`, never guessed) says whether it is in
the download queue. Queue entries are matched to that host's SABnzbd by
download id, and SABnzbd's live percent and time left win over the arr's.
The request's percent is weighted by size across its entries (a season is
many), its ETA is the slowest entry. Stalls come from the arr's status
messages or SABnzbd's state; with nothing queued, a failed last download is
reported with the reason from the arr's history, or SABnzbd's when the arr
recorded none. Requests Seerr failed to hand to an arr are listed too.

The check runs in phases so each host is asked once however many requests
share it: locate every request, fetch each involved queue, fetch history
for requests with nothing queued, then build the rows. Anything that fails
lands in its own row; the rest of the answer still comes back.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable, Hashable, Iterable
from dataclasses import dataclass
from typing import Any

from maester.agent.tools import Tier, ToolContext, tool
from maester.clients.arr import HistoryEvent, QueueItem
from maester.clients.sabnzbd import Download
from maester.clients.seerr import MediaDetails, MediaRequest, RequestStatus
from maester.formatting import humanized
from maester.library import Library, Owner, OwnerUnknown
from maester.media import version_label

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


@dataclass(frozen=True)
class Located:
    """Phase one for a request: its title, and the arr holding its copy (or why not)."""

    request: MediaRequest
    details: MediaDetails
    owner: Owner | None
    unknown: str | None = None  # why the owner can't be named


async def locate(library: Library, request: MediaRequest) -> Located:
    details = await library.services.seerr.media_details(request.media_type, request.tmdb_id)
    try:
        return Located(request, details, await library.owner(details, is_4k=request.is_4k))
    except OwnerUnknown as exc:
        return Located(request, details, None, str(exc))


async def fetch_each[K: Hashable](
    keys: Iterable[K], fetch: Callable[[K], Awaitable[Any]]
) -> dict[K, Any]:
    """Fetch every key once, concurrently; a failure is kept as that key's value."""
    unique = list(dict.fromkeys(keys))
    results = await asyncio.gather(*map(fetch, unique), return_exceptions=True)
    return dict(zip(unique, results, strict=True))


def last_failure(events: list[HistoryEvent], sab_history: Any) -> dict[str, Any]:
    """Nothing is queued: say whether the last download failed, and why."""
    if not events or events[0].event_type != "downloadFailed":
        return {"download": "nothing downloading right now; waiting for a release to grab"}
    reason = events[0].message
    if not reason and isinstance(sab_history, dict):
        failed = sab_history.get(events[0].download_id or "")
        reason = failed.fail_message if failed and failed.fail_message else ""
    return {"failed": f"the last download failed: {reason or 'no reason recorded'}"}


def request_row(located: Located | BaseException, request: MediaRequest) -> dict[str, Any]:
    row: dict[str, Any] = {
        "request_id": request.id,
        "version": version_label(request.is_4k),
        "request": request.status.label,
        "availability": request.media_status.label,
    }
    if request.seasons:
        row["seasons"] = list(request.seasons)
    if isinstance(located, BaseException):
        return {
            **row,
            "title": f"TMDB {request.tmdb_id}",
            "error": f"couldn't look it up: {located}",
        }
    row["title"] = located.details.display
    if request.status == RequestStatus.FAILED:
        row["failed"] = (
            "Seerr couldn't hand it to Radarr or Sonarr; the admin can retry it in Seerr."
        )
    return row


async def _by_nzo(rows: Awaitable[list[Download]]) -> dict[str, Download]:
    return {d.nzo_id: d for d in await rows}


def _mine(queue: list[QueueItem] | BaseException, owner: Owner) -> list[QueueItem] | BaseException:
    if isinstance(queue, BaseException):
        return queue
    return [q for q in queue if q.media_id == owner.media_id]


def download(
    owner: Owner,
    items: list[QueueItem] | BaseException,
    sab_queue: Any,
    history: Any,
    sab_history: Any,
) -> dict[str, Any]:
    """An approved request's download, from what the phases fetched (failures included)."""
    arr = f"{'Radarr' if owner.kind == 'movie' else 'Sonarr'} on {owner.host}"
    if isinstance(items, BaseException):
        return {"host": owner.host, "error": f"couldn't reach {arr}: {items}"}
    if items:
        slots = sab_queue if isinstance(sab_queue, dict) else {}
        return {"host": owner.host, **merged_progress(items, slots)}
    if isinstance(history, BaseException):
        return {"host": owner.host, "error": f"couldn't read {arr} history: {history}"}
    return {"host": owner.host, **last_failure(history, sab_history)}


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
    services = ctx.services
    # Seerr's "unavailable" filter holds pending and approved requests; failed ones are apart.
    waiting, failed = await asyncio.gather(
        *(
            services.seerr.list_requests(user_id=user.seerr_user_id, take=OPEN_REQUESTS, filter=f)
            for f in ("unavailable", "failed")
        )
    )
    requests = sorted({r.id: r for r in (*waiting, *failed)}.values(), key=lambda r: -r.id)
    if not requests:
        return {"requests": [], "note": "No open requests."}
    library = await Library.load(services)

    # 1. Each request's title and the arr holding its copy.
    located = dict(
        zip(
            (r.id for r in requests),
            await asyncio.gather(*(locate(library, r) for r in requests), return_exceptions=True),
            strict=True,
        )
    )
    owners = {
        rid: loc.owner
        for rid, loc in located.items()
        if isinstance(loc, Located) and loc.owner and loc.request.status == RequestStatus.APPROVED
    }
    # 2. Each involved arr queue and SABnzbd queue, once.
    arrs = {(o.kind, o.host): o.arr for o in owners.values()}
    queues = await fetch_each(arrs, lambda key: arrs[key].queue())
    sabs = {o.host: services.sabnzbd[o.host] for o in owners.values() if o.host in services.sabnzbd}
    sab_queues = await fetch_each(sabs, lambda h: _by_nzo(sabs[h].queue()))
    items = {rid: _mine(queues[(o.kind, o.host)], o) for rid, o in owners.items()}
    # 3. History for requests with nothing queued, and their hosts' SABnzbd history.
    idle = {rid: o for rid, o in owners.items() if items[rid] == []}
    histories = await fetch_each(idle, lambda rid: idle[rid].arr.history(idle[rid].media_id))
    idle_sabs = [o.host for o in idle.values() if o.host in sabs]
    sab_histories = await fetch_each(idle_sabs, lambda h: _by_nzo(sabs[h].history()))

    # 4. The rows.
    rows = []
    for request in requests:
        loc = located[request.id]
        row = request_row(loc, request)
        if isinstance(loc, Located) and request.status == RequestStatus.APPROVED:
            if loc.unknown is not None:
                row["download"] = loc.unknown
            elif loc.owner is None:
                row["download"] = "not sent to Radarr or Sonarr yet"
            else:
                host = loc.owner.host
                row.update(
                    download(
                        loc.owner,
                        items[request.id],
                        sab_queues.get(host),
                        histories.get(request.id),
                        sab_histories.get(host),
                    )
                )
        rows.append(row)
    return {"requests": rows}
