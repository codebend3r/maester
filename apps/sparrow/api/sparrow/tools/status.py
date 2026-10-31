"""Where a friend's requests are: Seerr's state merged with the download.

For each open Seerr request, the arr holding that request's copy (standard
or 4K, found by `sparrow/library.py`, never guessed) says whether it is in
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
from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Any

from sparrow.agent.tools import Tier, ToolContext, tool
from sparrow.clients.arr import HistoryEvent, QueueItem
from sparrow.clients.base import Answers, gather_each
from sparrow.clients.sabnzbd import Download
from sparrow.clients.seerr import MediaDetails, MediaRequest, RequestStatus
from sparrow.formatting import humanized
from sparrow.library import Library, Owner, OwnerUnknown
from sparrow.media import version_label

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


def last_failure(
    events: list[HistoryEvent], sab_history: dict[str, Download] | None
) -> dict[str, Any]:
    """Nothing is queued: say whether the last download failed, and why."""
    if not events or events[0].event_type != "downloadFailed":
        return {"download": "nothing downloading right now; waiting for a release to grab"}
    reason = events[0].message
    if not reason and sab_history is not None:
        failed = sab_history.get(events[0].download_id or "")
        reason = failed.fail_message if failed and failed.fail_message else ""
    return {"failed": f"the last download failed: {reason or 'no reason recorded'}"}


def request_row(located: Located | str, request: MediaRequest) -> dict[str, Any]:
    """The request's own facts; `located` is why it couldn't be looked up, when it couldn't."""
    row: dict[str, Any] = {
        "request_id": request.id,
        "version": version_label(request.is_4k),
        "request": request.status.label,
        "availability": request.media_status.label,
    }
    if request.seasons:
        row["seasons"] = list(request.seasons)
    if isinstance(located, str):
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


Queues = Answers[tuple[str, str], list[QueueItem]]  # by (kind, host)


def queued(queues: Queues, owner: Owner) -> list[QueueItem] | None:
    """The owner's queue entries for the title; None when its queue couldn't be read."""
    queue = queues.answered.get((owner.kind.media_type, owner.host))
    return None if queue is None else [q for q in queue if q.media_id == owner.media_id]


@dataclass(frozen=True)
class Fetched:
    """Phases two and three: each involved queue, and the history of requests with nothing
    queued, as each host answered."""

    queues: Queues
    sab_queues: Answers[str, dict[str, Download]]
    histories: Answers[int, list[HistoryEvent]]  # by request id
    sab_histories: Answers[str, dict[str, Download]]


def download(owner: Owner, request_id: int, fetched: Fetched) -> dict[str, Any]:
    """An approved request's download, from what the phases fetched (failures included)."""
    arr = f"{owner.kind.arr_name} on {owner.host}"
    items = queued(fetched.queues, owner)
    if items is None:
        why = fetched.queues.unreachable[(owner.kind.media_type, owner.host)]
        return {"host": owner.host, "error": f"couldn't reach {arr}: {why}"}
    if items:
        slots = fetched.sab_queues.answered.get(owner.host, {})
        return {"host": owner.host, **merged_progress(items, slots)}
    if (why := fetched.histories.unreachable.get(request_id)) is not None:
        return {"host": owner.host, "error": f"couldn't read {arr} history: {why}"}
    sab_history = fetched.sab_histories.answered.get(owner.host)
    return {"host": owner.host, **last_failure(fetched.histories.answered[request_id], sab_history)}


@tool(
    "request_status",
    "The user's open requests: each with its Seerr state (waiting for approval, approved, "
    "failed) and, once approved, the download from the owning host's Radarr/Sonarr queue "
    "and SABnzbd merged into a percent and ETA. Stalled or failed downloads say why.",
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
    by_id = {r.id: r for r in requests}

    # 1. Each request's title and the arr holding its copy.
    located = await gather_each(by_id, lambda rid: locate(library, by_id[rid]))
    owners = {
        rid: loc.owner
        for rid, loc in located.answered.items()
        if loc.owner and loc.request.status == RequestStatus.APPROVED
    }
    # 2. Each involved arr queue and SABnzbd queue, once.
    arrs = {(o.kind.media_type, o.host): o.arr for o in owners.values()}
    sabs = {o.host: services.sabnzbd[o.host] for o in owners.values() if o.host in services.sabnzbd}
    queues, sab_queues = await asyncio.gather(
        gather_each(arrs, lambda key: arrs[key].queue()),
        gather_each(sabs, lambda h: _by_nzo(sabs[h].queue())),
    )
    # 3. History for requests with nothing queued, and their hosts' SABnzbd history.
    idle = {rid: o for rid, o in owners.items() if queued(queues, o) == []}
    histories, sab_histories = await asyncio.gather(
        gather_each(idle, lambda rid: idle[rid].arr.history(idle[rid].media_id)),
        gather_each(
            [o.host for o in idle.values() if o.host in sabs],
            lambda h: _by_nzo(sabs[h].history()),
        ),
    )
    fetched = Fetched(queues, sab_queues, histories, sab_histories)

    # 4. The rows.
    rows = []
    for request in requests:
        loc = located.answered.get(request.id) or located.unreachable[request.id]
        row = request_row(loc, request)
        if isinstance(loc, Located) and request.status == RequestStatus.APPROVED:
            if loc.unknown is not None:
                row["download"] = loc.unknown
            elif loc.owner is None:
                row["download"] = "not sent to Radarr or Sonarr yet"
            else:
                row.update(download(loc.owner, request.id, fetched))
        rows.append(row)
    return {"requests": rows}
