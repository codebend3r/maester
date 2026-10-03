"""Telling friends a replaced copy has landed: the new file their report asked for.

A replacement deletes the reported file and searches for a new one, and the
friend is told it's coming. This job follows up: every `CHECK_EVERY` it
looks at the replacements of the last `FOLLOW_FOR`, and once the copy's
owning arr holds a file other than the one deleted, it DMs everyone who
reported the old file, once each (claim source `landed`, per reporter and
file). The DM is about the copy, so a thumbs-down on it reports the new file.
A copy whose search never finds a release stops being followed after two
weeks; its Seerr issue stays open in the digest.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from luwin.clients import ClientError, Services
from luwin.library import NotLocated
from luwin.media import ReportStatus, Titled
from luwin.notify import DirectMessage, Notice
from luwin.playback.items import locate
from luwin.store import Store

CHECK_EVERY = timedelta(minutes=30)
FOLLOW_FOR = timedelta(days=14)
SOURCE = "landed"
# Longer than a replacement is followed, so each reporter hears once.
TOLD_FOR = timedelta(days=30)


async def tell_landed(services: Services, store: Store) -> list[Notice]:
    since = datetime.now(UTC) - FOLLOW_FOR
    notices: list[Notice] = []
    checked: set[int] = set()
    for row in store.acted_since(("replace_media", "decide_replacement"), since):
        report = store.get_report(int(row.args.get("report_id", 0)))
        if report is None or report.status is not ReportStatus.REPLACED or report.id in checked:
            continue
        checked.add(report.id)
        try:
            located = await locate(services, report.copy)
        except (NotLocated, ClientError):  # not there yet, or its arr didn't answer
            continue
        if located.file.id == report.file_id:
            continue
        reporters = {
            r.discord_id
            for r in store.reports_for_file(report.host, report.copy.media_type, report.file_id)
        }
        for who in sorted(reporters):
            key = f"{who}:{report.host}:{report.copy.media_type}:{report.file_id}"
            if store.claim(SOURCE, key, window=TOLD_FOR):
                text = (
                    f"The new {report.copy.version} copy of {report.title} is on the server now. "
                    "Give it another try, and tell me if it's still wrong."
                )
                notices.append(DirectMessage(who, text, Titled(report.copy, report.title)))
    return notices
