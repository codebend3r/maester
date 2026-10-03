"""Replacing a broken copy, guarded: evidence, a Confirm button, a daily cap, a kill switch.

`replace_media` is destructive, so the model's call only puts Confirm and
Cancel in front of the friend; nothing happens until they press Confirm.
Then, whatever the model said, it runs only on stored evidence about that
very file (`Evidence`): a failed health check, or two people reporting it.
It acts only on the friend's own report, from a status a friend may start
from (`MAY_REPLACE`), only on the host that owns the copy, and only while
the file is still the one reported.

A day holds at most `REPLACE_DAILY_CAP` replacements that friends confirm,
counted from the audit log. Past it, the report escalates and the admin's
Approve runs `decide_replacement`, a button-only admin tool; what the admin
approves is their own call, so it doesn't count toward the cap. Their Deny
declines that report only. Both tools are destructive: the runner runs
them one at a time, checking the kill switch as each one's turn comes, so
counting and acting can't interleave. Each replacement sends the admin one
notice with the path, size and reason.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

from luwin.agent.tools import Approval, Result, Tier, ToolContext, tool
from luwin.formatting import gigabytes
from luwin.library import NotLocated
from luwin.media import ReportStatus
from luwin.notify import DirectMessage
from luwin.playback.items import LocatedFile, locate
from luwin.playback.replace import admin_notice, replace_copy
from luwin.playback.reports import (
    DECLINE,
    ESCALATE,
    MAY_REPLACE,
    NOT_NOW,
    POLICIES,
    REOPEN,
    Actor,
    Evidence,
    move,
)
from luwin.store import ReportRow

CAP_WINDOW = timedelta(days=1)


class Refused(Exception):
    """The replacement can't go ahead; the message says why."""


@dataclass(frozen=True)
class Ready:
    """A report whose file may be replaced, located on its owning host."""

    report: ReportRow
    located: LocatedFile
    evidence: Evidence


def waiting_on_admin(ctx: ToolContext, report: ReportRow) -> bool:
    """An escalated report whose approval is still open (they expire)."""
    return any(
        p.payload.get("report_id") == report.id
        for p in ctx.store.open_pending("approve", action="decide_replacement")
    )


async def ready(ctx: ToolContext, report: ReportRow, host: str, actor: Actor) -> Ready:
    """The report's file, still there on `host` and proven broken by stored evidence."""
    if report.status not in MAY_REPLACE[actor]:
        raise Refused(f"Report {report.id} can't be acted on: {NOT_NOW[report.status]}.")
    if host.lower() != report.host:
        raise Refused(f"{report.title} in {report.copy.version} is on {report.host}, not {host}.")
    try:
        located = await locate(ctx.services, report.copy)
    except NotLocated as exc:
        raise Refused(f"There's nothing to replace: {exc}.") from exc
    if located.owner.host != report.host or located.file.id != report.file_id:
        raise Refused(
            f"The file reported in report {report.id} is no longer there; it was replaced or "
            "changed since. If the new one is broken too, report it again."
        )
    evidence = Evidence.for_file(ctx.store, report.host, report.copy.media_type, report.file_id)
    if not evidence.proven:
        raise Refused(
            f"Not replacing {located.label}: {evidence.describe()}. It can be replaced once a "
            "file check fails or a second person reports the same copy."
        )
    return Ready(report, located, evidence)


async def carry_out(ctx: ToolContext, go: Ready) -> Result:
    """Replace the file; the result says every step, and the admin hears once."""
    replacement = await replace_copy(ctx.services, ctx.store, go.report, go.located)
    reporters = [ctx.name_of(d) for d in go.evidence.reporters]
    notice = admin_notice(replacement, go.report, go.evidence, reporters)
    if not replacement.deleted and not replacement.retryable:
        # It stopped for good (no grab to blocklist): no approval should wait on it.
        move(ctx.store, go.report, REOPEN)
    return Result(
        replacement.text,
        (notice,),
        is_error=not replacement.deleted,
        retryable=replacement.retryable,
    )


def over_cap(ctx: ToolContext) -> bool:
    """Friends' confirmed replacements in the last day have used up the cap."""
    since = datetime.now(UTC) - CAP_WINDOW
    cap = ctx.settings.guardrails.replace_daily_cap
    return ctx.store.audit_count_since("replace_media", since) >= cap


def ask_admin(ctx: ToolContext, go: Ready) -> Result:
    """Over the cap: the report escalates, and the admin decides with the same facts."""
    if move(ctx.store, go.report, ESCALATE) is None:
        return Result.refusal(f"Report {go.report.id} is no longer open.")
    located, cap = go.located, ctx.settings.guardrails.replace_daily_cap
    who = ctx.name_of(ctx.user_id)
    where = f"{located.label} on {located.owner.host}"
    label = POLICIES[go.report.kind].label
    notice = (
        f"{who} asks to replace {where} ({label}; {go.evidence.describe()}). The daily cap "
        f"of {cap} replacements is used up, so it's your call. File: {located.file.path} "
        f"({gigabytes(located.file.size_bytes)})."
    )
    return Result(
        f"The daily cap of {cap} replacements is used up, so the admin decides on "
        f"replacing {where}.",
        approval=Approval(
            notice=notice,
            summary=f"Replace {where} for {who}",
            decide="decide_replacement",
            args={"report_id": go.report.id, "host": go.report.host, "requester": ctx.user_id},
        ),
    )


REPLACE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "report_id": {"type": "integer", "description": "The report_id report_problem gave."},
        "host": {"type": "string", "description": "The host report_problem named."},
    },
    "required": ["report_id", "host"],
    "additionalProperties": False,
}


@tool(
    "replace_media",
    "Replace a broken copy the user reported: blocklist its release, delete the file and "
    "search for a new copy, on the host that owns it. Only when report_problem offered it; "
    "the user must press Confirm, and it still runs only if a file check failed or two "
    "people reported the same copy. Over the daily cap it goes to the admin instead.",
    REPLACE_SCHEMA,
    tier=Tier.FRIEND,
    destructive=True,
    host_param="host",
    held_in_maintenance=True,
)
async def replace_media(ctx: ToolContext, report_id: int, host: str) -> Result:
    report = ctx.store.get_report(report_id)
    if report is None or (report.discord_id != ctx.user_id and ctx.tier < Tier.ADMIN):
        return Result.refusal(f"There's no report {report_id} of yours to act on.")
    if report.status is ReportStatus.ESCALATED and not waiting_on_admin(ctx, report):
        report = move(ctx.store, report, REOPEN) or report  # its approval lapsed: open again
    try:
        go = await ready(ctx, report, host, Actor.FRIEND)
    except Refused as why:
        return Result.refusal(str(why))
    if over_cap(ctx):
        return ask_admin(ctx, go)
    return await carry_out(ctx, go)


@tool(
    "decide_replacement",
    "The admin's decision on a replacement over the daily cap.",
    {
        "type": "object",
        "properties": {
            **REPLACE_SCHEMA["properties"],
            "requester": {"type": "string", "description": "The friend's Discord id."},
            "approved": {"type": "boolean"},
        },
        "required": ["report_id", "host", "requester", "approved"],
        "additionalProperties": False,
    },
    tier=Tier.ADMIN,
    destructive=True,
    host_param="host",
    button_only=True,
)
async def decide_replacement(
    ctx: ToolContext, report_id: int, host: str, requester: str, approved: bool
) -> Result:
    """Replace the file, or decline this report's replacement, and tell the friend."""
    report = ctx.store.get_report(report_id)
    if report is None:
        return Result.refusal(f"Report {report_id} no longer exists.")
    if not approved:
        if move(ctx.store, report, DECLINE) is None:
            return Result.refusal(
                f"Report {report.id} isn't waiting on you: {NOT_NOW[report.status]}."
            )
        dm = (
            f"The admin decided not to replace {report.title} in {report.copy.version} for "
            "now; your report stays open in Seerr."
        )
        left = f"Left {report.title} in {report.copy.version} as it is."
        return Result(left, (DirectMessage(requester, dm),))
    try:
        go = await ready(ctx, report, host, Actor.ADMIN)
    except Refused as why:
        return Result.refusal(str(why))
    result = await carry_out(ctx, go)
    return replace(result, notices=(*result.notices, DirectMessage(requester, result.content)))
