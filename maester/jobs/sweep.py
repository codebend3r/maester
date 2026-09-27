"""The stalled-download sweeper: stuck downloads blocklisted and searched again, or surfaced.

Every `SWEEP_MINUTES` it reads each host's Radarr and Sonarr queue. A
download is stuck when its arr flags it (a warning or an error: stalled
with no connections, nothing it can import) or when it stops moving while
downloading. What is still stuck after `STALLED_HOURS` is removed from the
download client with its release blocklisted, and its movie or episodes are
searched again on the same host. A title that stalls again within
`STALL_MEMORY` of being searched again is surfaced to the admin instead:
another release would likely stall too, and searching forever helps nobody.
One removed whose search then didn't start goes to the admin too, since no
later sweep would see it.

Waiting isn't stalling: a paused download, one queued behind others, one a
delay profile holds, or one whose client can't be reached (the client's
problem, not the release's) is not stuck. A download is timed per sweep in
`queue_watch`, so a restart doesn't reset the clock, and one missing from a
single queue read keeps its row for `WATCH_GRACE` before it's forgotten.

The kill switch stops removals (a stalled download waits until it's off),
and a maintenance window pauses the sweep: services restarting look stuck.
Every removal and surfacing is audited as `sweep_stalled` and kept in
`stalls`, which the digest reports.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

from maester.agent.limits import KillSwitch
from maester.clients import ClientError, Services
from maester.clients.arr import QueueItem
from maester.config import Settings
from maester.formatting import humanized
from maester.library import ARR_NAMES
from maester.notify import AdminPost, Notice
from maester.store import MAINTENANCE, StallAction, Store, Watched
from maester.store.base import stamp

log = logging.getLogger("maester.jobs")

TOOL = "sweep_stalled"
# How long a title's re-search is remembered: stalling again within it surfaces the title.
STALL_MEMORY = timedelta(days=30)
# How long a download the queue stopped listing is remembered, in case it's back next read.
WATCH_GRACE = timedelta(days=1)
# States in which a download waits its turn rather than stalls.
WAITING = {"paused", "queued", "delay", "downloadclientunavailable"}


@dataclass(frozen=True)
class Download:
    """One download in a host's queue: every queue record that shares its download id."""

    host: str
    kind: str  # movie | tv
    download_id: str
    records: tuple[QueueItem, ...]

    @property
    def first(self) -> QueueItem:
        return self.records[0]

    @property
    def title(self) -> str:
        labels = list(dict.fromkeys(r.label for r in self.records))
        return labels[0] if len(labels) == 1 else f"{labels[0]} and {len(labels) - 1} more"

    @property
    def waiting(self) -> bool:
        return self.first.status.lower() in WAITING

    @property
    def flagged(self) -> bool:
        return any(r.tracked_status in ("warning", "error") for r in self.records)

    @property
    def size_left(self) -> int:
        return max(r.size_left_bytes for r in self.records)

    @property
    def episode_ids(self) -> tuple[int, ...]:
        return tuple(sorted({r.episode_id for r in self.records if r.episode_id is not None}))

    @property
    def item(self) -> str:
        """The title it's for, so the same movie or episodes stalling again is recognized."""
        if self.kind == "movie":
            return f"movie:{self.first.media_id}"
        return f"tv:{self.first.media_id}:{','.join(map(str, self.episode_ids))}"

    def reason(self, stuck: timedelta) -> str:
        messages = list(dict.fromkeys(m for r in self.records for m in r.error_messages))
        if messages:
            return "; ".join(messages)
        if self.flagged:
            return f"{ARR_NAMES[self.kind]} marks it {self.first.tracked_status}"
        return f"no progress for {humanized(int(stuck.total_seconds()))}"


def downloads(host: str, kind: str, queue: Sequence[QueueItem]) -> list[Download]:
    """The queue's downloads the arr grabbed for a title it knows: one it doesn't (added to
    the client by hand) isn't the sweeper's to remove, nor a show's with no episode named."""
    by_id: dict[str, list[QueueItem]] = {}
    for record in queue:
        known = record.media_id and (kind == "movie" or record.episode_id is not None)
        if record.download_id and known:
            by_id.setdefault(record.download_id, []).append(record)
    return [Download(host, kind, d, tuple(rs)) for d, rs in by_id.items()]


def stuck_since(download: Download, before: Watched | None, now: str) -> str | None:
    """Since when a download has been stuck, carried over from the last sweep; None if not."""
    if download.waiting:
        return None
    earlier = before.stuck_since if before else None
    if download.flagged:
        return earlier or now
    if before is None or download.size_left < before.size_left:
        return None  # new, or moving
    if download.first.status.lower() == "downloading":
        return earlier or now
    return None


class Sweeper:
    def __init__(
        self, services: Services, store: Store, settings: Settings, kill_switch: KillSwitch
    ):
        self.services = services
        self.store = store
        self.stalled_after = settings.jobs.stalled_after
        self.kill_switch = kill_switch

    async def __call__(self) -> list[Notice]:
        """One sweep of every host's queues; the notices are titles surfaced to the admin."""
        if self.store.flag(MAINTENANCE):
            return []
        notices: list[Notice] = []
        for kind, clients in (("movie", self.services.radarr), ("tv", self.services.sonarr)):
            for host, arr in sorted(clients.items()):
                try:
                    queue = await arr.queue()
                except ClientError as exc:
                    log.warning("sweep: %s on %s didn't answer: %s", ARR_NAMES[kind], host, exc)
                    continue
                notices += await self.sweep(host, kind, arr, queue)
        return notices

    async def sweep(
        self, host: str, kind: str, arr: Any, queue: Sequence[QueueItem]
    ) -> list[Notice]:
        now = datetime.now(UTC)
        before = self.store.watched(host, kind)
        seen: dict[str, Watched] = {}
        notices: list[Notice] = []
        for download in downloads(host, kind, queue):
            last = before.get(download.download_id)
            since = stuck_since(download, last, stamp(now))
            watched = Watched(download.size_left, since, last.acted_at if last else None)
            stuck = now - datetime.fromisoformat(since) if since else timedelta(0)
            if since and not watched.acted_at and stuck >= self.stalled_after:
                acted, notice = await self.act(arr, download, download.reason(stuck))
                if acted:
                    watched = replace(watched, acted_at=stamp(now))
                notices += notice
            seen[download.download_id] = watched
        self.store.watch(host, kind, seen, forget_before=now - WATCH_GRACE)
        return notices

    async def act(self, arr: Any, download: Download, reason: str) -> tuple[bool, list[Notice]]:
        """Search it again, or surface it; True once it's handled."""
        host, kind, item = download.host, download.kind, download.item
        earlier = self.store.researched_since(host, kind, item, datetime.now(UTC) - STALL_MEMORY)
        if earlier:
            text = (
                f"{download.title} stalled again on {host} ({reason}). It was blocklisted and "
                f"searched again on {earlier[:10]}, so another release may stall too; it's left "
                f"in {ARR_NAMES[kind]}'s queue for you."
            )
            self._record(download, reason, StallAction.SURFACED, text, ok=True)
            return True, [AdminPost(text)]
        if self.kill_switch.enabled:
            return False, []  # removing is destructive; it waits for the switch
        try:
            await arr.remove_from_queue(download.first.id, blocklist=True)
        except ClientError as exc:
            text = f"Couldn't clear {download.title} on {host}: {exc}"
            self._record(download, reason, StallAction.FAILED, text, ok=False)
            return False, []
        try:
            if kind == "movie":
                await arr.movies_search([download.first.media_id])
            else:
                await arr.episode_search(list(download.episode_ids))
        except ClientError as exc:
            # It's out of the queue now, so no later sweep would search for it: the admin does.
            text = (
                f"{download.title} on {host} stalled ({reason}): blocklisted that release and "
                f"removed it, but the search didn't start ({exc}). Search for it in "
                f"{ARR_NAMES[kind]} on {host}."
            )
            self._record(download, reason, StallAction.REMOVED, text, ok=False)
            return True, [AdminPost(text)]
        text = (
            f"{download.title} on {host} stalled ({reason}): blocklisted that release, removed "
            "it and searched again."
        )
        self._record(download, reason, StallAction.RESEARCHED, text, ok=True)
        return True, []

    def _record(
        self, download: Download, reason: str, action: StallAction, text: str, *, ok: bool
    ) -> None:
        self.store.record_stall(
            host=download.host,
            kind=download.kind,
            item=download.item,
            title=download.title,
            reason=reason,
            action=action,
        )
        self.store.audit(
            discord_id=None,
            tool=TOOL,
            args={"title": download.title, "download_id": download.download_id, "action": action},
            result=text,
            ok=ok,
            host=download.host,
        )
