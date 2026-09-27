"""Replacing a broken copy: blocklist its release, delete the file, search again.

Everything happens on the host that owns the copy (`items.locate`), in
order, and stops at the first step that fails, so a release that couldn't
be blocklisted isn't deleted and grabbed straight back:

1. blocklist: the grab that brought the file in (its download, found
   through the arr's import history) is marked failed, which blocklists the
   release. The arrs take no reason for it; the reason stays on maester's
   report and in the admin's notice.
2. delete: the movie or episode file.
3. search: the movie, or every episode the file held.

Each step's outcome is kept (`Step`), so the reply, the audit row, the
admin's notice and the Seerr issue all say exactly what happened.
"""

from __future__ import annotations

import enum
import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass

from maester.clients import ClientError, Services
from maester.clients.arr import HistoryEvent
from maester.notify import AdminPost
from maester.playback.items import Item, LocatedFile
from maester.playback.reports import Evidence, policy_of
from maester.store import ReportRow, Store

log = logging.getLogger("maester.playback")

RETRY = (
    "A new copy usually lands within a few hours when a release is out there. Try again "
    "later today, and tell me if it's still broken tomorrow."
)


def item_of(report: ReportRow) -> Item:
    return Item(report.media_type, report.tmdb_id, report.is_4k, report.season, report.episode)


def gigabytes(size: int) -> str:
    return f"{size / 1e9:.1f} GB"


def grab_of(history: Iterable[HistoryEvent], file_id: int) -> HistoryEvent | None:
    """The grab that brought a file in: the import that made it, then its download's grab."""
    history = list(history)
    imported = next(
        (
            e
            for e in history
            if e.event_type == "downloadFolderImported" and e.file_id == file_id and e.download_id
        ),
        None,
    )
    if imported is None:
        return None
    return next(
        (e for e in history if e.event_type == "grabbed" and e.download_id == imported.download_id),
        None,
    )


class Status(enum.StrEnum):
    DONE = "done"
    SKIPPED = "skipped"
    FAILED = "failed"
    NOT_RUN = "not run"


@dataclass(frozen=True)
class Step:
    name: str
    status: Status
    detail: str

    @property
    def line(self) -> str:
        return f"- {self.name}: {self.detail}"


async def _blocklist(located: LocatedFile) -> tuple[Status, str]:
    owner = located.owner
    grab = grab_of(await owner.arr.history(owner.media_id), located.file.id)
    if grab is None:
        return Status.SKIPPED, "no grab of this file in the history, so no release to block"
    await owner.arr.mark_failed(grab.id)
    return Status.DONE, f"marked {grab.source_title} failed so it isn't grabbed again"


async def _delete(located: LocatedFile) -> tuple[Status, str]:
    await located.owner.delete_file(located.file.id)
    file = located.file
    return Status.DONE, f"deleted {file.path} ({gigabytes(file.size_bytes)})"


async def _search(located: LocatedFile) -> tuple[Status, str]:
    await located.owner.search(located.search_ids)
    return Status.DONE, "searching for a new copy"


STEPS: tuple[tuple[str, Callable[[LocatedFile], Awaitable[tuple[Status, str]]]], ...] = (
    ("blocklist", _blocklist),
    ("delete", _delete),
    ("search", _search),
)


@dataclass(frozen=True)
class Replacement:
    located: LocatedFile
    steps: tuple[Step, ...]

    def _done(self, name: str) -> bool:
        return any(s.name == name and s.status is Status.DONE for s in self.steps)

    @property
    def deleted(self) -> bool:
        return self._done("delete")

    @property
    def text(self) -> str:
        """What the friend is told: each step, and when to try again."""
        located = self.located
        lines = [f"Replacing {located.copy} on {located.owner.host}:"]
        lines += [s.line for s in self.steps]
        if not self.deleted:
            lines.append("Nothing was deleted; the admin has been told.")
        elif self._done("search"):
            lines.append(RETRY)
        else:
            lines.append("The search didn't start; the admin has been told and can start it.")
        return "\n".join(lines)


async def run_steps(located: LocatedFile) -> tuple[Step, ...]:
    """Every step in order, stopping at the first failure."""
    steps: list[Step] = []
    for name, act in STEPS:
        if steps and steps[-1].status in (Status.FAILED, Status.NOT_RUN):
            steps.append(Step(name, Status.NOT_RUN, "not run, since the step before failed"))
            continue
        try:
            steps.append(Step(name, *await act(located)))
        except ClientError as exc:
            steps.append(Step(name, Status.FAILED, f"failed: {exc}"))
    return tuple(steps)


def admin_notice(
    replacement: Replacement, report: ReportRow, evidence: Evidence, reporters: Iterable[str]
) -> AdminPost:
    """One notice per replacement: the path, size and reason, and every step."""
    located, file = replacement.located, replacement.located.file
    host = located.owner.host
    if replacement.deleted:
        head = f"Deleted {file.path} ({gigabytes(file.size_bytes)}) on {host}: {located.copy}."
    else:
        head = f"Replacing {located.copy} on {host} stopped before {file.path} was deleted."
    lines = [
        head,
        f"Reason: {policy_of(report).label}; {evidence.describe()}. "
        f"Reported by {', '.join(sorted(reporters))}.",
        *(s.line for s in replacement.steps),
    ]
    if report.seerr_issue_id:
        lines.append(f"Seerr issue #{report.seerr_issue_id}.")
    return AdminPost("\n".join(lines))


async def replace_copy(
    services: Services, store: Store, report: ReportRow, located: LocatedFile
) -> Replacement:
    """Run the steps, then record the outcome on the reports and the Seerr issue."""
    replacement = Replacement(located, await run_steps(located))
    if replacement.deleted:
        store.mark_file_replaced(report.host, report.media_type, report.file_id)
    if report.seerr_issue_id:
        try:
            await services.seerr.comment_issue(report.seerr_issue_id, replacement.text)
        except ClientError as exc:  # the trail in Seerr is a courtesy; the audit row is the record
            log.warning("couldn't note the replacement on issue %s: %s", report.seerr_issue_id, exc)
    return replacement
