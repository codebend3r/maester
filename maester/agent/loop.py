"""One turn of conversation: stream the model, run tools, loop, remember.

The model client is injected so tests and evals can script it; in the app it
is `anthropic.AsyncAnthropic()`. The loop follows the Messages API manual
pattern: stream a response, execute every `tool_use` block, send all results
back in one user message, repeat until `end_turn`, a refusal, or the
iteration cap.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from maester.agent.limits import LimitExceeded, RateLimiter
from maester.agent.prompts import SYSTEM_PROMPT
from maester.agent.runner import ToolOutcome, ToolRunner
from maester.agent.tools import Choice, Tier, ToolContext
from maester.clients import Services
from maester.config import Settings
from maester.memo import Memo
from maester.notify import Notice
from maester.store import PendingAction, Store

log = logging.getLogger("maester.agent")

MAX_TOOL_ITERATIONS = 8
MAX_TOKENS = 4096
HISTORY_TOKEN_BUDGET = 12_000
# Tool results larger than this are stored in memory as a stub: the model saw
# the full result this turn, and later turns only need to know it happened.
STORED_RESULT_MAX_CHARS = 600
IDLE_RESET = timedelta(hours=6)

REFUSAL_REPLY = "I can't help with that one."
LIMIT_REPLY = "You've hit the {what} limit for now; {hint}."
TRUNCATED_REPLY = "That reply got too long and was cut off; ask me again more narrowly."


def estimate_tokens(content: Any) -> int:
    """Cheap and stable: the budget only needs to be roughly right."""
    text = content if isinstance(content, str) else str(content)
    return max(1, len(text) // 4)


@dataclass
class AgentReply:
    text: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    pending_ids: list[int] = field(default_factory=list)
    # Options a tool offered the user, rendered as buttons by the chat layer.
    choices: list[Choice] = field(default_factory=list)
    # What tools asked to post outside the reply: admin notices and approvals.
    notices: list[Notice] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    iterations: int = 0


class TurnFailed(Exception):
    """A turn broke partway through.

    `reply` holds what the turn's tools had already done (pending
    confirmations, notices for the admin), so a failure after a tool acted
    does not lose the buttons or the notice that go with it.
    """

    def __init__(self, reply: AgentReply):
        self.reply = reply
        super().__init__("the turn failed partway through")


class Agent:
    def __init__(
        self,
        *,
        model_client: Any,
        model: str,
        runner: ToolRunner,
        store: Store,
        services: Services,
        settings: Settings,
        limiter: RateLimiter | None = None,
        effort: str = "medium",
        system_prompt: str = SYSTEM_PROMPT,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ):
        self.client = model_client
        self.model = model
        self.runner = runner
        self.store = store
        self.services = services
        self.limiter = limiter
        self.effort = effort
        self.system_prompt = system_prompt
        self.settings = settings
        self.now = now
        # What tools share across calls (a health check, a speed test), for the app's life.
        self.memo = Memo()

    def forget(self, user_id: str) -> int:
        return self.store.clear_messages(user_id)

    def _context(self, user_id: str, tier: Tier) -> ToolContext:
        return ToolContext(
            user_id=user_id,
            tier=tier,
            services=self.services,
            store=self.store,
            settings=self.settings,
            memo=self.memo,
        )

    async def run_decision(
        self, pending: PendingAction, user_id: str, tier: Tier, approved: bool
    ) -> ToolOutcome:
        """Run what a button press decided, as the presser, and remember a confirmation.

        A confirmed call's model only got "waiting for confirmation", so the
        real outcome goes into the requester's conversation as a fresh
        tool_use/tool_result pair; their next turn sees it like any tool. An
        approval's decide tool is the admin's, and its requester hears
        through the DM it sends, not through their conversation.
        """
        outcome = await self.runner.run_decision(self._context(user_id, tier), pending, approved)
        if pending.kind == "confirm":
            self._remember(pending, outcome)
        return outcome

    def _remember(self, pending: PendingAction, outcome: ToolOutcome) -> None:
        tool_use = {
            "type": "tool_use",
            "id": f"toolu_button_{pending.id}",
            "name": pending.action,
            "input": pending.payload,
        }
        results = self._stub_results([outcome.as_result_block(tool_use["id"])])
        user_id = pending.requester
        self.store.append_message(user_id, "assistant", [tool_use], estimate_tokens(tool_use))
        self.store.append_message(user_id, "user", results, estimate_tokens(results))

    async def respond(
        self,
        user_id: str,
        tier: Tier,
        text: str,
        *,
        on_text: Callable[[str], Any] | None = None,
    ) -> AgentReply:
        if self.limiter:
            try:
                self.limiter.check_message(user_id)
                self.limiter.check_tokens(user_id)
            except LimitExceeded as exc:
                return AgentReply(LIMIT_REPLY.format(what=exc.what, hint=exc.retry_hint))

        reply = AgentReply(text="")
        try:
            await self._turn(user_id, tier, text, reply, on_text)
        except Exception as exc:
            raise TurnFailed(reply) from exc
        finally:
            if self.limiter:
                self.limiter.add_tokens(user_id, reply.input_tokens + reply.output_tokens)
        return reply

    async def _turn(
        self,
        user_id: str,
        tier: Tier,
        text: str,
        reply: AgentReply,
        on_text: Callable[[str], Any] | None,
    ) -> None:
        """Run one turn, recording into `reply` as it goes."""
        ctx = self._context(user_id, tier)
        history = self.store.recent_messages(
            user_id, max_tokens=HISTORY_TOKEN_BUDGET, since=self.now() - IDLE_RESET
        )
        user_message = {"role": "user", "content": text}
        messages = [*history, user_message]
        self.store.append_message(user_id, "user", text, estimate_tokens(text))

        tools = self.runner.registry.definitions(tier)
        json_retries = 0

        for _ in range(MAX_TOOL_ITERATIONS + 1):
            try:
                response = await self._stream_turn(messages, tools, on_text)
            except ValueError:
                # Eager streaming handed the SDK JSON it could not parse at
                # all; nothing to answer, so re-issue the turn, bounded.
                json_retries += 1
                if json_retries > 2:
                    raise
                continue
            reply.iterations += 1
            reply.input_tokens += response.usage.input_tokens
            reply.output_tokens += response.usage.output_tokens
            reply.cache_read_tokens += getattr(response.usage, "cache_read_input_tokens", 0) or 0

            content = [b.to_dict() for b in response.content]
            assistant_message = {"role": "assistant", "content": content}
            messages.append(assistant_message)
            self.store.append_message(user_id, "assistant", content, response.usage.output_tokens)

            if response.stop_reason == "pause_turn":
                continue
            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if response.stop_reason == "refusal":
                reply.text = REFUSAL_REPLY
                break
            if not tool_uses:
                reply.text = self._text_of(response.content) or reply.text
                break
            if response.stop_reason == "max_tokens":
                # A truncated tool input parses as a valid partial object.
                reply.text = TRUNCATED_REPLY
                break

            results = []
            for block in tool_uses:
                outcome = await self.runner.run(ctx, block.name, block.input)
                reply.tool_calls.append(
                    {"name": block.name, "input": block.input, "ok": not outcome.is_error}
                )
                if outcome.pending_id is not None:
                    reply.pending_ids.append(outcome.pending_id)
                if outcome.choices:  # the latest picker wins
                    reply.choices = list(outcome.choices)
                reply.notices.extend(outcome.notices)
                results.append(outcome.as_result_block(block.id))
            messages.append({"role": "user", "content": results})
            self.store.append_message(
                user_id, "user", self._stub_results(results), estimate_tokens(results)
            )
        else:
            reply.text = (
                reply.text or "I ran out of steps on that one; try asking for a smaller piece."
            )

    async def _stream_turn(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        on_text: Callable[[str], Any] | None,
    ) -> Any:
        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": MAX_TOKENS,
            "system": [
                {"type": "text", "text": self.system_prompt, "cache_control": {"type": "ephemeral"}}
            ],
            "messages": list(messages),
            "output_config": {"effort": self.effort},
        }
        if tools:
            params["tools"] = tools
        async with self.client.messages.stream(**params) as stream:
            async for event in stream:
                if on_text and event.type == "text":
                    on_text(event.text)
            return await stream.get_final_message()

    @staticmethod
    def _text_of(content: list[Any]) -> str:
        return "".join(b.text for b in content if b.type == "text").strip()

    @staticmethod
    def _stub_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        stubbed = []
        for r in results:
            content = r.get("content", "")
            if isinstance(content, str) and len(content) > STORED_RESULT_MAX_CHARS:
                r = {**r, "content": content[:STORED_RESULT_MAX_CHARS] + " …[truncated in memory]"}
            stubbed.append(r)
        return stubbed
