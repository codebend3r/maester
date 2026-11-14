"""Executes tool calls, with every guardrail in one place.

A call reaches a tool one of two ways, and both pass the same admission
(`_admit`: the tool exists, suits the caller's tier, and the input matches
its schema, since eager streaming means the server did not check it) before
it runs and is audited:

- `run()`: the model asked. A destructive tool's call is not run: it becomes
  a pending confirmation and the model hears "waiting for confirmation".
- `run_decision()`: the caller pressed Confirm or Cancel on that pending
  confirmation. Only the requester who recorded the decision may run it, and
  destructive runs go one at a time, so a daily cap counted from the audit
  log can't be raced.

What a handler answers (`Result` or plain JSON) is turned into what the chat
layer renders.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import AbstractAsyncContextManager, nullcontext
from dataclasses import dataclass, replace
from datetime import timedelta
from typing import Any

from sparrow.agent.tools import (
    Answer,
    Choice,
    Failed,
    Ok,
    Refused,
    Title,
    ToolContext,
    ToolRegistry,
    ToolSpec,
    ValidationError,
)
from sparrow.notify import AdminPost, Notice
from sparrow.store import Decision, NotLinked, PendingAction

log = logging.getLogger("sparrow.agent")

CONFIRMATION_TTL = timedelta(minutes=5)
# What the admin's notice of a confirmed action keeps of what the run said.
CONFIRMED_RESULT_CHARS = 500


@dataclass(frozen=True)
class Done:
    """The call ran and answered."""


@dataclass(frozen=True)
class Errored:
    """The call was refused, or failed. Trying again may succeed only when `retryable` (a
    service that didn't answer, a tool that raised): only then is a press reopened."""

    retryable: bool = False


@dataclass(frozen=True)
class AwaitingConfirmation:
    """A destructive call the caller must confirm, with this pending action's button."""

    pending_id: int


@dataclass(frozen=True)
class Cancelled:
    """The caller pressed Cancel: nothing ran."""


# What became of a call: exactly one of these.
Status = Done | Errored | AwaitingConfirmation | Cancelled


@dataclass(frozen=True)
class ToolOutcome:
    content: Any
    status: Status = Done()
    choices: tuple[Choice, ...] = ()
    notices: tuple[Notice, ...] = ()
    titles: tuple[Title, ...] = ()

    @property
    def is_error(self) -> bool:
        return isinstance(self.status, Errored)

    @property
    def text(self) -> str:
        if isinstance(self.content, str):
            return self.content
        return json.dumps(self.content, default=str)

    def as_result_block(self, tool_use_id: str) -> dict[str, Any]:
        return {
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": self.text,
            **({"is_error": True} if self.is_error else {}),
        }


@dataclass(frozen=True)
class Admitted:
    """A call that passed admission: the tool, and its arguments as stored and audited."""

    spec: ToolSpec
    args: dict[str, Any]


def may_decide(pending: PendingAction, user_id: str) -> bool:
    """Only the person who asked for a destructive call confirms or cancels it."""
    return pending.requester == user_id


def outcome_of(answer: Answer) -> ToolOutcome:
    """What the chat layer renders of a handler's answer."""
    match answer:
        case Ok(content, notices, titles, choices):
            return ToolOutcome(content, notices=notices, titles=titles, choices=choices)
        case Refused(content, notices):
            return ToolOutcome(content, Errored(), notices=notices)
        case Failed(content, notices, retryable):
            return ToolOutcome(content, Errored(retryable), notices=notices)
        case _:
            return ToolOutcome(answer)


class ToolRunner:
    def __init__(self, registry: ToolRegistry):
        self.registry = registry
        # Destructive runs (only button presses make them) go one at a time, each audited
        # before the next starts, so a daily cap counted from the audit log can't be raced.
        self._destructive = asyncio.Lock()

    def _one_at_a_time(self, spec: ToolSpec) -> AbstractAsyncContextManager[Any]:
        return self._destructive if spec.destructive else nullcontext()

    def summarize(self, spec: ToolSpec, args: dict[str, Any]) -> str:
        host = (
            f" on {args[spec.host_param]}" if spec.host_param and args.get(spec.host_param) else ""
        )
        shown = {k: v for k, v in args.items() if k != spec.host_param}
        return f"{spec.name}{host}: {json.dumps(shown, default=str)}"

    def _admit(self, ctx: ToolContext, name: str, raw: object) -> Admitted | ToolOutcome:
        """The call, once its tool exists, suits the caller and its input fits; else the
        refusal, audited."""
        spec = self.registry.get(name)
        if spec is None or spec.tier > ctx.tier:
            return self._refuse(ctx, name, raw, f"tool {name!r} is not available to you")
        try:
            return Admitted(spec, spec.validate(raw))
        except ValidationError as exc:
            return self._refuse(
                ctx,
                name,
                raw,
                json.dumps({"INVALID_JSON": json.dumps(raw, default=str), "error": str(exc)}),
            )

    async def run(self, ctx: ToolContext, name: str, raw_input: object) -> ToolOutcome:
        """A call the model asked for."""
        admitted = self._admit(ctx, name, raw_input)
        if isinstance(admitted, ToolOutcome):
            return admitted
        if admitted.spec.destructive:
            return self._request_confirmation(ctx, admitted)
        return await self._execute(ctx, admitted)

    async def run_decision(
        self, ctx: ToolContext, pending: PendingAction, approved: bool
    ) -> ToolOutcome:
        """What a Confirm or Cancel press decided, run as the presser (`ctx`)."""
        if not approved:
            return ToolOutcome("Cancelled by the user; nothing was done.", Cancelled())
        if pending.decision != Decision.APPROVED or pending.decided_by != ctx.user_id:
            return self._refuse(ctx, pending.action, pending.payload, "that action was not decided")
        if not may_decide(pending, ctx.user_id):
            return self._refuse(ctx, pending.action, pending.payload, "that action isn't yours")
        admitted = self._admit(ctx, pending.action, pending.payload)
        if isinstance(admitted, ToolOutcome):
            return admitted
        if not admitted.spec.destructive:
            return self._refuse(ctx, pending.action, pending.payload, "that action needs no press")
        async with self._one_at_a_time(admitted.spec):
            outcome = await self._execute(ctx, admitted)
        if any(isinstance(n, AdminPost) for n in outcome.notices):
            # A tool that posts its own account of it (a delete with path and size) says it once.
            return outcome
        who = ctx.name_of(ctx.user_id)
        done = AdminPost(
            f"{who} confirmed: {pending.summary}\n{outcome.text[:CONFIRMED_RESULT_CHARS]}"
        )
        return replace(outcome, notices=(*outcome.notices, done))

    async def _execute(self, ctx: ToolContext, admitted: Admitted) -> ToolOutcome:
        spec, args = admitted.spec, admitted.args
        started = time.monotonic()
        try:
            outcome = outcome_of(await spec.call(ctx, args))
        except NotLinked as exc:  # no Seerr account to act as: the same refusal as any tool's
            outcome = outcome_of(Refused(str(exc)))
        except Exception as exc:  # a tool failing must not take the turn down
            log.exception("tool %s failed", spec.name)
            outcome = ToolOutcome(f"{type(exc).__name__}: {exc}", Errored(retryable=True))
        host = args.get(spec.host_param) if spec.host_param else None
        self._audit(ctx, spec.name, args, outcome, host, self._ms(started))
        return outcome

    def _request_confirmation(self, ctx: ToolContext, admitted: Admitted) -> ToolOutcome:
        summary = self.summarize(admitted.spec, admitted.args)
        pending = ctx.store.create_pending(
            action=admitted.spec.name,
            requester=ctx.user_id,
            payload=admitted.args,
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
            AwaitingConfirmation(pending.id),
        )

    def _refuse(self, ctx: ToolContext, name: str, args: object, why: str) -> ToolOutcome:
        outcome = ToolOutcome(why, Errored())
        self._audit(ctx, name, args if isinstance(args, dict) else {}, outcome, None, 0)
        return outcome

    @staticmethod
    def _ms(started: float) -> int:
        return int((time.monotonic() - started) * 1000)

    @staticmethod
    def _audit(
        ctx: ToolContext,
        name: str,
        args: dict[str, Any],
        outcome: ToolOutcome,
        host: str | None,
        ms: int,
    ) -> None:
        ctx.store.audit(
            user_id=ctx.user_id,
            tool=name,
            args=args,
            result=outcome.content,
            ok=not outcome.is_error,
            host=host,
            duration_ms=ms,
        )
