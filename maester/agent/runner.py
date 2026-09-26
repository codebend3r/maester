"""Executes tool calls the model asks for, with every guardrail in one place.

Order of checks for a call:

1. The tool exists and the caller's tier may use it (rejected server-side
   even though the model was never shown out-of-tier tools).
2. The input validates against the schema (eager streaming means the
   server did not).
3. Destructive tools: the kill switch is off, and unless the call carries a
   confirmed pending-action id, the call is turned into a pending action
   and the model gets back "waiting for confirmation" instead of a result.
4. The handler runs; its result or error is audited with timing.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from maester.agent.limits import KillSwitch
from maester.agent.tools import (
    Tier,
    ToolContext,
    ToolRegistry,
    ToolSpec,
    ValidationError,
    validate_input,
)

log = logging.getLogger("maester.agent")

CONFIRMATION_TTL = timedelta(minutes=5)
CONFIRMED_KEY = "_confirmed_pending_id"


@dataclass(frozen=True)
class ToolOutcome:
    content: Any
    is_error: bool = False
    pending_id: int | None = None

    def as_result_block(self, tool_use_id: str) -> dict[str, Any]:
        content = (
            self.content if isinstance(self.content, str) else json.dumps(self.content, default=str)
        )
        block: dict[str, Any] = {
            "type": "tool_result",
            "tool_use_id": tool_use_id,
            "content": content,
        }
        if self.is_error:
            block["is_error"] = True
        return block


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
        spec = self.registry.get(name)
        if spec is None or spec.tier > ctx.tier:
            outcome = ToolOutcome(f"tool {name!r} is not available to you", is_error=True)
            self._audit(
                ctx, name, raw_input if isinstance(raw_input, dict) else {}, outcome, None, 0
            )
            return outcome

        # The confirmation id rides along in the input but is not part of any
        # tool's schema, so it comes out before validation.
        confirmed_id = None
        if isinstance(raw_input, dict) and CONFIRMED_KEY in raw_input:
            raw_input = {**raw_input}
            confirmed_id = raw_input.pop(CONFIRMED_KEY)
        try:
            args = validate_input(spec.input_schema, raw_input)
        except ValidationError as exc:
            return ToolOutcome(
                json.dumps({"INVALID_JSON": json.dumps(raw_input, default=str), "error": str(exc)}),
                is_error=True,
            )

        host = args.get(spec.host_param) if spec.host_param else None

        if spec.destructive:
            if self.kill_switch.enabled:
                outcome = ToolOutcome(
                    f"{name} is disabled right now"
                    + (f": {self.kill_switch.reason}" if self.kill_switch.reason else ""),
                    is_error=True,
                )
                self._audit(ctx, name, args, outcome, host, 0)
                return outcome
            if confirmed_id is None:
                return self._request_confirmation(ctx, spec, args)
            pending = ctx.store.get_pending(int(confirmed_id)) if ctx.store else None
            if (
                pending is None
                or pending.decision != "approved"
                or pending.requester != ctx.user_id
            ):
                outcome = ToolOutcome("that action was not confirmed", is_error=True)
                self._audit(ctx, name, args, outcome, host, 0)
                return outcome

        started = time.monotonic()
        try:
            result = await spec.handler(ctx, **args)
            outcome = ToolOutcome(result)
        except Exception as exc:  # a tool failing must not take the turn down
            log.exception("tool %s failed", name)
            outcome = ToolOutcome(f"{type(exc).__name__}: {exc}", is_error=True)
        self._audit(ctx, name, args, outcome, host, int((time.monotonic() - started) * 1000))
        return outcome

    def _request_confirmation(
        self, ctx: ToolContext, spec: ToolSpec, args: dict[str, Any]
    ) -> ToolOutcome:
        summary = self.summarize(spec, args)
        if ctx.store is None:
            return ToolOutcome("confirmation is required but no store is configured", is_error=True)
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

    def _audit(
        self,
        ctx: ToolContext,
        name: str,
        args: dict[str, Any],
        outcome: ToolOutcome,
        host: str | None,
        ms: int,
    ) -> None:
        if ctx.store is None:
            return
        ctx.store.audit(
            discord_id=ctx.user_id,
            tool=name,
            args=args,
            result=outcome.content,
            ok=not outcome.is_error,
            host=host,
            duration_ms=ms,
        )


def tier_of(user_tier: Tier | str) -> Tier:
    return user_tier if isinstance(user_tier, Tier) else Tier.parse(user_tier)
