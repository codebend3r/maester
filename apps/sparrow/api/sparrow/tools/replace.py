"""Replacing a broken copy, guarded: evidence, a Confirm button and a daily cap.

`replace_media` is destructive, so the model's call only puts Confirm and
Cancel in front of the friend; nothing happens until they press Confirm.
Then, whatever the model said, it runs only on stored evidence about that
very file (`Evidence`): a failed health check, or two people reporting it.
It acts only on the friend's own report, from a status a friend may start
from (`MAY_REPLACE`), only on the host that owns the copy, and only while
the file is still the one reported.

A day holds at most `REPLACE_DAILY_CAP` replacements that friends confirm,
counted from the audit log; past it, the call refuses until the day is
over. The tool is destructive: the runner runs confirmed replacements one at
a time, so counting and acting can't interleave. Each replacement sends the
admin one notice with the path, size and reason.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

from pydantic import Field

from sparrow.agent.tools import Failed, Ok, Refused, Result, Tier, ToolContext, tool
from sparrow.library import NotLocated
from sparrow.playback.items import LocatedFile, locate
from sparrow.playback.replace import admin_notice, replace_copy
from sparrow.playback.reports import MAY_REPLACE, NOT_NOW, Evidence
from sparrow.store import ReportRow

CAP_WINDOW = timedelta(days=1)


@dataclass(frozen=True)
class Ready:
    """A report whose file may be replaced, located on its owning host."""

    report: ReportRow
    located: LocatedFile
    evidence: Evidence


async def ready(ctx: ToolContext, report: ReportRow, host: str) -> Ready | Refused:
    """The report's file, still there on `host` and proven broken by stored evidence."""
    if report.status not in MAY_REPLACE:
        return Refused(f"Report {report.id} can't be acted on: {NOT_NOW[report.status]}.")
    if host.lower() != report.host:
        return Refused(f"{report.title} in {report.copy.version} is on {report.host}, not {host}.")
    try:
        located = await locate(ctx.services, report.copy)
    except NotLocated as exc:
        return Refused(f"There's nothing to replace: {exc}.")
    if located.owner.host != report.host or located.file.id != report.file_id:
        return Refused(
            f"The file reported in report {report.id} is no longer there; it was replaced or "
            "changed since. If the new one is broken too, report it again."
        )
    evidence = Evidence.for_file(ctx.store, report.host, report.copy.media_type, report.file_id)
    if not evidence.proven:
        return Refused(
            f"Not replacing {located.label}: {evidence.describe()}. It can be replaced once a "
            "file check fails or a second person reports the same copy."
        )
    return Ready(report, located, evidence)


async def carry_out(ctx: ToolContext, go: Ready) -> Result:
    """Replace the file; the result says every step, and the admin hears once."""
    replacement = await replace_copy(ctx.services, ctx.store, go.report, go.located)
    reporters = [ctx.name_of(d) for d in go.evidence.reporters]
    notice = admin_notice(replacement, go.report, go.evidence, reporters)
    if replacement.deleted:
        return Ok(replacement.text, (notice,))
    return Failed(replacement.text, (notice,), retryable=replacement.retryable)


def over_cap(ctx: ToolContext) -> bool:
    """Friends' confirmed replacements in the last day have used up the cap."""
    since = datetime.now(UTC) - CAP_WINDOW
    cap = ctx.settings.guardrails.replace_daily_cap
    return ctx.store.audit_count_since("replace_media", since) >= cap


# The report a replacement is about, and the host report_problem named for its copy.
ReportId = Annotated[int, Field(description="The report_id report_problem gave.")]
ReportHost = Annotated[str, Field(description="The host report_problem named.")]


@tool(
    "replace_media",
    "Replace a broken copy the user reported: blocklist its release, delete the file and "
    "search for a new copy, on the host that owns it. Only when report_problem offered it; "
    "the user must press Confirm, and it still runs only if a file check failed or two "
    "people reported the same copy, and not past the daily cap.",
    tier=Tier.FRIEND,
    destructive=True,
    host_param="host",
)
async def replace_media(ctx: ToolContext, report_id: ReportId, host: ReportHost) -> Result:
    report = ctx.store.get_report(report_id)
    if report is None or (report.user_id != ctx.user_id and ctx.tier < Tier.ADMIN):
        return Refused(f"There's no report {report_id} of yours to act on.")
    go = await ready(ctx, report, host)
    if isinstance(go, Refused):
        return go
    if over_cap(ctx):
        cap = ctx.settings.guardrails.replace_daily_cap
        return Refused(
            f"The daily cap of {cap} replacements is used up, so {go.located.label} isn't "
            "replaced today; ask again tomorrow, or ask the admin."
        )
    return await carry_out(ctx, go)
