"""Replacing a broken copy, guarded: evidence, a Confirm button, a daily cap, a kill switch.

`replace_media` is destructive, so the model's call only puts Confirm and
Cancel in front of the friend; nothing happens until they press Confirm.
Then, whatever the model said, it runs only on stored evidence about that
very file (`Evidence`): a failed health check, or two people reporting it,
and never once the admin has said no. It acts only on the friend's own
report while that report can still lead to a new copy (not one already
waiting on the admin, declined or replaced), only on the host that owns the
copy, and only while the file is still the one reported.

A day holds at most `REPLACE_DAILY_CAP` replacements that friends confirm
(counted from the audit log, where a refusal or a call that only asked is
never counted). Past it, the confirmed request goes to the admin instead,
and their Approve runs `decide_replacement`, a button-only admin tool; what
the admin approves is their own call, so it doesn't count toward the cap.
Both tools are destructive, so the kill switch stops either at once, and
each replacement sends the admin one notice with the path, size and reason.
Checking and acting happen under one lock, so two confirmations at once
can't both slip under the cap or both replace one file.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

from maester.agent.tools import Approval, Result, Tier, ToolContext, tool
from maester.formatting import gigabytes
from maester.library import NotLocated
from maester.notify import DirectMessage
from maester.playback.items import LocatedFile, locate
from maester.playback.replace import admin_notice, replace_copy
from maester.playback.reports import Action, Evidence, policy_of
from maester.store import ReportRow

CAP_WINDOW = timedelta(days=1)
# The report states a friend's confirmed replacement may start from, and why
# the others can't.
FRIEND_MAY_REPLACE = frozenset({Action.REPLACEABLE, Action.RECORDED})
ADMIN_MAY_REPLACE = frozenset({Action.ESCALATED})
WHY_NOT = {
    Action.ADVISED: "it was a player problem, not the file",
    Action.FOR_ADMIN: "a new copy doesn't fix that kind of problem",
    Action.ESCALATED: "it's already waiting on the admin",
    Action.DECLINED: "the admin decided not to replace it",
    Action.REPLACED: "it was already replaced",
    Action.REPLACEABLE: "it isn't waiting on the admin",
    Action.RECORDED: "it isn't waiting on the admin",
}
# Checking the evidence and the cap, and replacing, happen one at a time.
_one_at_a_time = asyncio.Lock()


class Refused(Exception):
    """The replacement can't go ahead; the message says why."""


@dataclass(frozen=True)
class Ready:
    """A report whose file may be replaced, located on its owning host."""

    report: ReportRow
    located: LocatedFile
    evidence: Evidence


async def ready(
    ctx: ToolContext, report: ReportRow, host: str, allowed: frozenset[Action]
) -> Ready:
    """The report's file, still there on `host` and proven broken by stored evidence."""
    if (action := Action(report.action)) not in allowed:
        raise Refused(f"Report {report.id} can't be acted on: {WHY_NOT[action]}.")
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
    evidence = Evidence.of(
        ctx.store.reports_for_file(report.host, report.copy.media_type, report.file_id)
    )
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
    return Result(
        replacement.text,
        (notice,),
        is_error=not replacement.deleted,
        retryable=replacement.retryable,
    )


def over_cap(ctx: ToolContext) -> bool:
    """Friends' confirmed replacements in the last day have used up the cap."""
    since = datetime.now(UTC) - CAP_WINDOW
    return (
        ctx.store.audit_count_since("replace_media", since)
        >= ctx.settings.guardrails.replace_daily_cap
    )


def ask_admin(ctx: ToolContext, go: Ready) -> Result:
    """Over the cap: the admin decides, with the same facts the friend confirmed."""
    ctx.store.update_report(go.report.id, action=Action.ESCALATED)
    located, cap = go.located, ctx.settings.guardrails.replace_daily_cap
    who = ctx.name_of(ctx.user_id)
    where = f"{located.label} on {located.owner.host}"
    notice = (
        f"{who} asks to replace {where} ({policy_of(go.report).label}; {go.evidence.describe()}). "
        f"The daily cap of {cap} replacements is used up, so it's your call. File: {located.file.path} "
        f"({gigabytes(located.file.size_bytes)})."
    )
    return Result(
        f"The daily cap of {cap} replacements is used up, so the admin decides on replacing {where}.",
        approval=Approval(
            notice=notice,
            summary=f"Replace {where} for {who}",
            decide="decide_replacement",
            args={"report_id": go.report.id, "host": go.report.host, "requester": ctx.user_id},
        ),
    )


def refused(why: Refused | str) -> Result:
    return Result(str(why), is_error=True)


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
)
async def replace_media(ctx: ToolContext, report_id: int, host: str) -> Result:
    report = ctx.store.get_report(report_id)
    if report is None or (report.discord_id != ctx.user_id and ctx.tier < Tier.ADMIN):
        return refused(f"There's no report {report_id} of yours to act on.")
    async with _one_at_a_time:
        try:
            go = await ready(ctx, report, host, FRIEND_MAY_REPLACE)
        except Refused as why:
            return refused(why)
        if over_cap(ctx):
            return ask_admin(ctx, go)
        # The audit row that counts this one is written as the tool returns,
        # before anyone waiting on the lock can check the cap.
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
    """Replace the file, or leave it, and tell the friend either way."""
    report = ctx.store.get_report(report_id)
    if report is None:
        return refused(f"Report {report_id} no longer exists.")
    if not approved:
        ctx.store.update_report(report.id, action=Action.DECLINED)
        dm = (
            f"The admin decided not to replace {report.title} in {report.copy.version} for now; "
            "your report stays open in Seerr."
        )
        return Result(
            f"Left {report.title} in {report.copy.version} as it is.",
            (DirectMessage(requester, dm),),
        )
    async with _one_at_a_time:
        try:
            go = await ready(ctx, report, host, ADMIN_MAY_REPLACE)
        except Refused as why:
            return refused(why)
        result = await carry_out(ctx, go)
    return replace(result, notices=(*result.notices, DirectMessage(requester, result.content)))
