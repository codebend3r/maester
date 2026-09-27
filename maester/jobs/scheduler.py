"""Runs the scheduled jobs on the app's loop and delivers what they say.

A job is a name, when it runs (`At` a time of day, or `Every` so often) and
an async function returning notices, which go out through the `Notifier`
like any tool's. A job that fails is logged and runs again at its next
time; it never takes the others down.

Each slot of a job at a time of day is claimed (`claims`, source "job",
keyed by job and slot) before it runs, so a restart can't run one twice.
A slot missed while the app was down still runs on start if it was due
within `CATCH_UP`: a digest a few hours late beats none.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from maester.jobs.schedule import At, Every
from maester.notify import Notice, Notifier
from maester.store import Store
from maester.store.base import stamp

log = logging.getLogger("maester.jobs")

SOURCE = "job"
CATCH_UP = timedelta(hours=6)
# Longer than the longest schedule (a week), so a slot's claim outlives its chance to repeat.
SLOTS_KEPT = timedelta(days=8)


@dataclass(frozen=True)
class Job:
    name: str
    when: At | Every
    run: Callable[[], Awaitable[Sequence[Notice]]]


class Scheduler:
    def __init__(
        self,
        jobs: Sequence[Job],
        *,
        store: Store,
        notifier: Notifier,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self.jobs = tuple(jobs)
        self.store = store
        self.notifier = notifier
        self.clock = clock
        self.sleep = sleep

    async def run(self) -> None:
        """Keep every job on time; returns only when cancelled."""
        await asyncio.gather(*(self._keep(job) for job in self.jobs))

    async def _keep(self, job: Job) -> None:
        when = job.when
        if isinstance(when, Every):
            while True:
                await self.sleep(when.interval.total_seconds())
                await self.run_now(job)
        missed = when.last(self.clock())
        if self.clock() - missed <= CATCH_UP:
            await self._run_slot(job, missed)
        while True:
            slot = when.next(self.clock())
            await self.sleep(max(0.0, (slot - self.clock()).total_seconds()))
            await self._run_slot(job, slot)

    async def _run_slot(self, job: Job, slot: datetime) -> None:
        if self.store.claim(SOURCE, f"{job.name}@{stamp(slot)}", window=SLOTS_KEPT):
            await self.run_now(job)

    async def run_now(self, job: Job) -> None:
        """Run a job once and deliver its notices; a failure is logged, never raised."""
        try:
            notices = await job.run()
        except Exception:
            log.exception("job %s failed", job.name)
            return
        if undelivered := await self.notifier.deliver(notices):
            log.warning("job %s: %d notices not delivered", job.name, len(undelivered))
