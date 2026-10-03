"""Why a download failed: the arr's history and queue for a title, with SABnzbd's own record.

`download_history` is the admin's: "why did Dune fail?" answered from the
logs they'd otherwise read by hand. It reads the owning host's Radarr or
Sonarr history for the copy (grabs, failures, imports, deletions, with the
indexer, release and reason each names), what of it sits in that arr's
queue now, and SABnzbd's history and queue on the same host for those
downloads, matched by download id: SABnzbd's failure message and the
repair and unpack steps that went wrong. The model reads it and says what
happened and what to do next. Read-only: it changes nothing anywhere.

A host the admin names must be the one holding the copy; with none named,
the owner is found (`luwin/library.py`) and named in the answer.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from luwin.agent.tools import Result, Tier, ToolContext, tool
from luwin.clients import ClientError
from luwin.clients.arr import HistoryEvent, QueueItem
from luwin.clients.sabnzbd import Download
from luwin.library import ARR_NAMES, NotLocated, Owner, owner_of, owner_on

# The newest history events shown, and how far back SABnzbd's history is read.
EVENTS_SHOWN = 15
SAB_HISTORY = 200

EVENT_NAMES = {
    "grabbed": "grabbed",
    "downloadFailed": "download failed",
    "downloadFolderImported": "imported",
    "movieFolderImported": "imported from its folder",
    "seriesFolderImported": "imported from its folder",
    "movieFileDeleted": "file deleted",
    "episodeFileDeleted": "file deleted",
    "movieFileRenamed": "file renamed",
    "episodeFileRenamed": "file renamed",
    "downloadIgnored": "ignored",
}


def event_row(e: HistoryEvent) -> dict[str, Any]:
    row: dict[str, Any] = {
        "when": e.date,
        "event": EVENT_NAMES.get(e.event_type, e.event_type),
        "release": e.source_title,
    }
    extras = {
        "indexer": e.indexer,
        "quality": e.quality,
        "release_group": e.release_group,
        "why": e.message or e.reason,
    }
    return {**row, **{k: v for k, v in extras.items() if v}}


def queue_row(q: QueueItem) -> dict[str, Any]:
    row: dict[str, Any] = {
        "release": q.title,
        "status": q.status,
        "percent": q.percent,
        "arr_says": q.tracked_status,
    }
    if q.error_messages:
        row["messages"] = list(q.error_messages)
    if q.time_left:
        row["time_left"] = q.time_left
    return row


def sab_row(d: Download) -> dict[str, Any]:
    row: dict[str, Any] = {"name": d.name, "status": d.status}
    if d.fail_message:
        row["why"] = d.fail_message
    if d.trouble:
        row["steps"] = list(d.trouble)
    if d.completed:
        row["finished"] = datetime.fromtimestamp(d.completed, UTC).isoformat()
    elif d.status and d.time_left:
        row["time_left"] = d.time_left
    return row


async def sab_record(ctx: ToolContext, host: str, ids: set[str]) -> dict[str, Any]:
    """SABnzbd's history and queue on `host` for these download ids."""
    sab = ctx.services.sabnzbd.get(host)
    if sab is None:
        return {"sabnzbd_note": f"no SABnzbd is configured on {host}"}
    if not ids:
        return {"sabnzbd": []}
    try:
        done, running = await asyncio.gather(sab.history(limit=SAB_HISTORY), sab.queue())
    except ClientError as exc:
        return {"sabnzbd_note": f"SABnzbd on {host} didn't answer: {exc}"}
    found = [d for d in (*running, *done) if d.nzo_id in ids]
    return {"sabnzbd": [sab_row(d) for d in found]}


async def owner_for(ctx: ToolContext, details: Any, host: str | None, is_4k: bool) -> Owner:
    if host:
        return await owner_on(ctx.services, details, host, is_4k=is_4k)
    return await owner_of(ctx.services, details, is_4k=is_4k)


@tool(
    "download_history",
    "Admin only: why a title's download failed or is stuck. Reads the owning host's "
    "Radarr/Sonarr history for that copy (grabs, failures, imports, deletions, with the "
    "indexer, release and reason) and what's in its queue now, with SABnzbd's own record of "
    "those downloads on that host (its failure message and the repair and unpack steps that "
    "went wrong). Give host when known; otherwise the owner is found. Summarize the cause "
    "and the next step in plain words.",
    {
        "type": "object",
        "properties": {
            "tmdb_id": {"type": "integer", "description": "The TMDB id from search_media."},
            "media_type": {"type": "string", "enum": ["movie", "tv"]},
            "version": {"type": "string", "enum": ["1080p", "4K"]},
            "host": {"type": "string", "description": "The host holding that copy, if known."},
        },
        "required": ["tmdb_id", "media_type"],
        "additionalProperties": False,
    },
    tier=Tier.ADMIN,
    host_param="host",
)
async def download_history(
    ctx: ToolContext,
    tmdb_id: int,
    media_type: str,
    version: str = "1080p",
    host: str | None = None,
) -> dict[str, Any] | Result:
    details = await ctx.services.seerr.media_details(media_type, tmdb_id)
    try:
        owner = await owner_for(ctx, details, host, is_4k=version == "4K")
    except NotLocated as exc:
        return Result.refusal(str(exc))
    arr = f"{ARR_NAMES[media_type]} on {owner.host}"
    try:
        history, queue = await asyncio.gather(owner.arr.history(owner.media_id), owner.arr.queue())
    except ClientError as exc:
        return Result(f"{arr} didn't answer: {exc}", is_error=True, retryable=True)
    mine = [q for q in queue if q.media_id == owner.media_id]
    ids = {e.download_id for e in history if e.download_id}
    ids |= {q.download_id for q in mine if q.download_id}
    return {
        "title": details.display,
        "version": version,
        "host": owner.host,
        "arr": arr,
        "queue": [queue_row(q) for q in mine],
        "history": [event_row(e) for e in history[:EVENTS_SHOWN]],
        **(await sab_record(ctx, owner.host, ids)),
        "note": "History is newest first. Say why the last download failed (or why it's stuck) "
        "and what to do next: search again, blocklist the release, free up space, fix the "
        "indexer. If nothing failed, say what it's waiting on.",
    }
