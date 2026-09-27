"""Executes tool calls, with every guardrail in one place.

A call reaches a tool one of two ways, and both end in the same checks,
run and audit:

- `run()`: the model asked. The tool must exist, be one the model may see
  (not button-only), and suit the caller's tier; the input must match the
  schema (eager streaming means the server did not check it). A
  destructive tool's call is not run: it becomes a pending confirmation and
  the model hears "waiting for confirmation".
- `run_decision()`: someone pressed a decision button. A confirmation runs
  the call the requester confirmed; an approval runs the button-only admin
  tool the approval named, with `approved` set by the press. Only whoever
  decided may run it, and only as their kind allows (the requester
  confirms, an admin approves).

A result that offers choices or carries a `Result` (notices, an approval
to ask for) is turned into what the chat layer renders. An approval is
checked against its decide tool's schema before it is stored.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, replace
from datetime import timedelta
from typing import Any

from maester.agent.limits import KillSwitch
from maester.agent.tools import (
    Approval,
    Choice,
    Choices,
    Result,
    ToolContext,
    ToolRegistry,
    ToolSpec,
    ValidationError,
    validate_input,
)
from maester.notify import AdminPost, ApprovalPost, Notice
from maester.store import PendingAction

log = logging.getLogger("maester.agent")

CONFIRMATION_TTL = timedelta(minutes=5)
APPROVAL_TTL = timedelta(days=7)


@dataclass(frozen=True)
class ToolOutcome:
    content: Any
    is_error: bool = False
    # A confirmation the caller must press before the call runs.
    pending_id: int | None = None
    # An approval the admin must press; the call is audited as waiting on it.
    approval_id: int | None = None
    choices: tuple[Choice, ...] = ()
    notices: tuple[Notice, ...] = ()
    # The tool itself failed (not a refusal), so trying again may succeed.
    retryable: bool = False

    @property
    def text(self) -> str:
        if isinstance(self.content, str):
            return self.content
        return json.dumps(self.content, default=str)

    def as_result_block(self, tool_use_id: str) -> dict[str, Any]:
        block: dict[str, Any] = {
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": self.text,
        }
        if self.is_error:
            block["is_error"] = True
        return block


CANCELLED = ToolOutcome("Cancelled by the user; nothing was done.")


class ToolRunner:
    def __init__(self, registry: ToolRegistry, *, kill_switch: KillSwitch | None = None):
        self.registry = registry
        self.kill_switch = kill_switch or KillSwitch()

    def summarize(self, spec: ToolSpec, args: dict[str, Any]) -> str:
        host = (
            f" on {args[spec.host_param]}" if spec.host_param and args.get(spec.host_param) else ""
        )
        shown = {k: v for k, v in args.items() if k != spec.host_param}
        return f"{spec.name}{host}: {json.dumps(shown, default=str)}"

    async def run(self, ctx: ToolContext, name: str, raw_input: Any) -> ToolOutcome:
        """A call the model asked for."""
        spec = self.registry.get(name)
        if spec is None or spec.button_only or spec.tier > ctx.tier:
            return self._refuse(ctx, name, raw_input, f"tool {name!r} is not available to you")
        try:
            args = validate_input(spec.input_schema, raw_input)
        except ValidationError as exc:
            return ToolOutcome(
                json.dumps({"INVALID_JSON": json.dumps(raw_input, default=str), "error": str(exc)}),
                is_error=True,
            )
        if spec.destructive:
            if self.kill_switch.enabled:
                return self._refuse(ctx, name, args, self._disabled(name), retryable=True)
            return self._request_confirmation(ctx, spec, args)
        return await self._execute(ctx, spec, args)

    async def run_decision(
        self, ctx: ToolContext, pending: PendingAction, approved: bool
    ) -> ToolOutcome:
        """What a button press decided, run as the presser (`ctx`)."""
        if pending.kind == "confirm" and not approved:
            return CANCELLED
        spec = self.registry.get(pending.action)
        if spec is None:
            return self._refuse(
                ctx, pending.action, pending.payload, "that action no longer exists"
            )
        if not self._may_run(ctx, spec, pending, approved):
            return self._refuse(ctx, spec.name, pending.payload, "that action was not decided")
        args = {**pending.payload, "approved": approved} if spec.button_only else pending.payload
        try:
            args = validate_input(spec.input_schema, args)
        except ValidationError as exc:
            return self._refuse(ctx, spec.name, args, f"stored arguments no longer fit: {exc}")
        if spec.destructive and self.kill_switch.enabled:
            return self._refuse(ctx, spec.name, args, self._disabled(spec.name), retryable=True)
        outcome = await self._execute(ctx, spec, args)
        if pending.kind == "confirm" and not any(
            isinstance(n, AdminPost | ApprovalPost) for n in outcome.notices
        ):
            # The admin hears about every confirmed action; a tool that posts
            # its own account of it (a delete with path and size, or a request
            # for their approval) says it once.
            who = ctx.name_of(ctx.user_id)
            done = AdminPost(f"{who} confirmed: {pending.summary}\n{outcome.text[:500]}")
            outcome = replace(outcome, notices=(*outcome.notices, done))
        return outcome

    @staticmethod
    def _may_run(ctx: ToolContext, spec: ToolSpec, pending: PendingAction, approved: bool) -> bool:
        """The presser recorded this very decision, and their kind of decision fits the tool."""
        decided = pending.decision == ("approved" if approved else "denied")
        if not decided or pending.decided_by != ctx.user_id or spec.tier > ctx.tier:
            return False
        if pending.kind == "confirm":
            return spec.destructive and pending.requester == ctx.user_id
        return spec.button_only

    async def _execute(self, ctx: ToolContext, spec: ToolSpec, args: dict[str, Any]) -> ToolOutcome:
        started = time.monotonic()
        try:
            outcome = self._outcome(ctx, spec, await spec.handler(ctx, **args))
        except Exception as exc:  # a tool failing must not take the turn down
            log.exception("tool %s failed", spec.name)
            outcome = ToolOutcome(f"{type(exc).__name__}: {exc}", is_error=True, retryable=True)
        host = args.get(spec.host_param) if spec.host_param else None
        self._audit(ctx, spec.name, args, outcome, host, self._ms(started))
        return outcome

    def _outcome(self, ctx: ToolContext, spec: ToolSpec, result: Any) -> ToolOutcome:
        if isinstance(result, Choices):
            return ToolOutcome(result.as_content(), choices=tuple(result.shown))
        if not isinstance(result, Result):
            return ToolOutcome(result)
        if result.approval is None:
            return ToolOutcome(
                result.content,
                is_error=result.is_error,
                notices=result.notices,
                retryable=result.retryable,
            )
        try:
            pending = self._ask_admin(ctx, result.approval)
        except (LookupError, ValidationError) as exc:
            # The tool has acted but its approval can't be raised: say so to
            # the admin rather than leave the action stranded unseen.
            log.error("%s raised an approval that cannot be decided: %s", spec.name, exc)
            stranded = AdminPost(
                f"{result.approval.notice}\nThis needs your decision, but no buttons could be "
                f"offered ({exc}); handle it by hand."
            )
            return ToolOutcome(
                f"the admin could not be asked for approval: {exc}",
                is_error=True,
                notices=(*result.notices, stranded),
            )
        content = {
            "status": "awaiting_admin_approval",
            "result": result.content,
            "note": "The admin has been asked to approve this in the admin channel. Tell the "
            "user it now waits on the admin and that they'll get a DM once it's decided. "
            "Do not call this tool again for it.",
        }
        post = ApprovalPost(result.approval.notice, pending.id)
        return ToolOutcome(content, approval_id=pending.id, notices=(*result.notices, post))

    def _ask_admin(self, ctx: ToolContext, approval: Approval) -> PendingAction:
        decide = self.registry.get(approval.decide)
        if decide is None or not decide.button_only:
            raise LookupError(f"{approval.decide!r} is not a registered admin decision tool")
        validate_input(decide.input_schema, {**approval.args, "approved": True})
        return ctx.store.create_pending(
            kind="approve",
            action=decide.name,
            requester=ctx.user_id,
            payload=approval.args,
            summary=approval.summary,
            ttl=APPROVAL_TTL,
        )

    def _request_confirmation(
        self, ctx: ToolContext, spec: ToolSpec, args: dict[str, Any]
    ) -> ToolOutcome:
        summary = self.summarize(spec, args)
        pending = ctx.store.create_pending(
            kind="confirm",
            action=spec.name,
            requester=ctx.user_id,
            payload=args,
            summary=summary,
            ttl=CONFIRMATION_TTL,
        )
        return ToolOutcome(
            {
                "status": "awaiting_confirmation",
                "pending_id": pending.id,
                "summary": summary,
                "note": "The user has been shown Confirm/Cancel buttons. Do not call this tool again; "
                "tell the user what will happen once they confirm.",
            },
            pending_id=pending.id,
        )

    def _refuse(
        self, ctx: ToolContext, name: str, args: Any, why: str, *, retryable: bool = False
    ) -> ToolOutcome:
        outcome = ToolOutcome(why, is_error=True, retryable=retryable)
        self._audit(ctx, name, args if isinstance(args, dict) else {}, outcome, None, 0)
        return outcome

    def _disabled(self, name: str) -> str:
        reason = self.kill_switch.reason
        return f"{name} is disabled right now" + (f": {reason}" if reason else "")

    @staticmethod
    def _ms(started: float) -> int:
        return int((time.monotonic() - started) * 1000)

    def _audit(
        self,
        ctx: ToolContext,
        name: str,
        args: dict[str, Any],
        outcome: ToolOutcome,
        host: str | None,
        ms: int,
    ) -> None:
        ctx.store.audit(
            discord_id=ctx.user_id,
            tool=name,
            args=args,
            result=outcome.content,
            ok=not outcome.is_error,
            host=host,
            duration_ms=ms,
            pending_id=outcome.approval_id,
        )
