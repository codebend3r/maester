"""One turn of conversation: call the model, run tools, loop, remember.

The model client is injected so tests and evals can script it; in the app it
is `anthropic.AsyncAnthropic()`. The loop follows the Messages API manual
pattern: get a response, execute every `tool_use` block, send all results
back in one user message, repeat until `end_turn`, a refusal, or the
iteration cap. A step that called tools is remembered only together with
its results, so the stored conversation never holds a `tool_use` without
the `tool_result` that answers it (the API rejects that on replay).
"""

from __future__ import annotations

import enum
import logging
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from anthropic.types import Message, TextBlock, ToolUseBlock

from sparrow.agent.limits import LimitExceeded, RateLimiter
from sparrow.agent.prompts import SYSTEM_PROMPT
from sparrow.agent.runner import AwaitingConfirmation, ToolOutcome, ToolRunner
from sparrow.agent.tools import Choice, Tier, Title, ToolContext
from sparrow.clients import Services
from sparrow.config import Settings
from sparrow.memo import Memo
from sparrow.notify import Notice
from sparrow.store import PendingAction, Store
from sparrow.store.conversations import Role, StoredMessage

log = logging.getLogger("sparrow.agent")

MAX_TOOL_ITERATIONS = 8
MAX_TOKENS = 4096
HISTORY_TOKEN_BUDGET = 12_000
# Tool results larger than this are stored in memory as a stub: the model saw
# the full result this turn, and later turns only need to know it happened.
STORED_RESULT_MAX_CHARS = 600
IDLE_RESET = timedelta(hours=6)
# How often a turn is re-issued when the SDK can't parse what eager streaming handed it.
JSON_RETRIES = 2

REFUSAL_REPLY = "I can't help with that one."
LIMIT_REPLY = "You've hit the {what} limit for now; {hint}."
TRUNCATED_REPLY = "That reply got too long and was cut off; ask me again more narrowly."
OUT_OF_STEPS_REPLY = "I ran out of steps on that one; try asking for a smaller piece."
# Sent once when the model ends a turn with no text, so the user still gets an answer.
CONTINUE_PROMPT = "Please continue."


class StopReason(enum.StrEnum):
    """The Messages API stop reasons the loop acts on."""

    END_TURN = "end_turn"
    TOOL_USE = "tool_use"
    MAX_TOKENS = "max_tokens"
    REFUSAL = "refusal"


class MessageStream(Protocol):
    async def get_final_message(self) -> Message: ...


class MessagesApi(Protocol):
    def stream(self, **params: Any) -> AbstractAsyncContextManager[MessageStream]: ...


class ModelClient(Protocol):
    """What the loop needs of `anthropic.AsyncAnthropic` (or `ClaudeCodeModel`)."""

    @property
    def messages(self) -> MessagesApi: ...


def estimate_tokens(content: object) -> int:
    """Cheap and stable: the budget only needs to be roughly right."""
    text = content if isinstance(content, str) else str(content)
    return max(1, len(text) // 4)


@dataclass(frozen=True)
class ToolTrace:
    """One tool call as a turn ran it, for a caller that shows the turn's work."""

    name: str
    input: dict[str, Any]
    ok: bool
    result: str


@dataclass
class AgentReply:
    text: str
    tool_calls: list[ToolTrace] = field(default_factory=list)
    pending_ids: list[int] = field(default_factory=list)
    # Options a tool offered the user, rendered as buttons by the chat layer.
    choices: list[Choice] = field(default_factory=list)
    # What tools asked to post outside the reply: notes for the admin, DMs.
    notices: list[Notice] = field(default_factory=list)
    # Titles tools found, shown with the reply (links); each once.
    titles: list[Title] = field(default_factory=list)
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


OnTool = Callable[[ToolTrace], object]


class Agent:
    def __init__(
        self,
        *,
        model_client: ModelClient,
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
        """Run what a Confirm or Cancel press decided, as the presser, and remember it.

        The confirmed call's model only got "waiting for confirmation", so the
        real outcome goes into the requester's conversation as a fresh
        tool_use/tool_result pair; their next turn sees it like any tool.
        """
        outcome = await self.runner.run_decision(self._context(user_id, tier), pending, approved)
        call_id = f"toolu_button_{pending.id}"
        tool_use = {
            "type": "tool_use",
            "id": call_id,
            "name": pending.action,
            "input": pending.payload,
        }
        results = self._stub_results([outcome.as_result_block(call_id)])
        self.store.append_messages(
            pending.requester,
            [
                StoredMessage(Role.ASSISTANT, [tool_use], estimate_tokens(tool_use)),
                StoredMessage(Role.USER, results, estimate_tokens(results)),
            ],
        )
        return outcome

    async def respond(
        self, user_id: str, tier: Tier, text: str, *, on_tool: OnTool | None = None
    ) -> AgentReply:
        if self.limiter:
            try:
                self.limiter.check_message(user_id)
                self.limiter.check_tokens(user_id)
            except LimitExceeded as exc:
                return AgentReply(LIMIT_REPLY.format(what=exc.what, hint=exc.retry_hint))

        reply = AgentReply(text="")
        try:
            await self._turn(user_id, tier, text, reply, on_tool)
        except Exception as exc:
            raise TurnFailed(reply) from exc
        finally:
            if self.limiter:
                self.limiter.add_tokens(user_id, reply.input_tokens + reply.output_tokens)
        return reply

    async def _turn(
        self, user_id: str, tier: Tier, text: str, reply: AgentReply, on_tool: OnTool | None
    ) -> None:
        """Run one turn, recording into `reply` as it goes."""
        ctx = self._context(user_id, tier)
        history = self.store.recent_messages(
            user_id, max_tokens=HISTORY_TOKEN_BUDGET, since=self.now() - IDLE_RESET
        )
        messages = [*history, {"role": Role.USER, "content": text}]
        self.store.append_messages(user_id, [StoredMessage(Role.USER, text, estimate_tokens(text))])

        tools = self.runner.registry.definitions(tier)
        is_nudged = False

        for _ in range(MAX_TOOL_ITERATIONS + 1):
            response = await self._call_model(messages, tools)
            reply.iterations += 1
            reply.input_tokens += response.usage.input_tokens
            reply.output_tokens += response.usage.output_tokens
            reply.cache_read_tokens += response.usage.cache_read_input_tokens or 0

            tool_uses = [b for b in response.content if isinstance(b, ToolUseBlock)]
            said = self._text_of(response)
            if response.stop_reason == StopReason.END_TURN and not tool_uses and not said:
                # Right after tool results the model can end its turn with nothing
                # to say. The API rejects an empty assistant message on replay, so
                # it is never kept; the model is asked once to carry on instead.
                if is_nudged:
                    return
                is_nudged = True
                messages.append({"role": Role.USER, "content": CONTINUE_PROMPT})
                continue

            assistant = StoredMessage(
                Role.ASSISTANT,
                [b.to_dict() for b in response.content],
                response.usage.output_tokens,
            )
            if not tool_uses:
                self.store.append_messages(user_id, [assistant])
                is_refused = response.stop_reason == StopReason.REFUSAL
                reply.text = REFUSAL_REPLY if is_refused else (said or reply.text)
                return
            if response.stop_reason in (StopReason.MAX_TOKENS, StopReason.REFUSAL):
                # A truncated tool input parses as a valid partial object, so nothing runs,
                # and the step isn't remembered: its tool_use would have no result.
                is_cut = response.stop_reason == StopReason.MAX_TOKENS
                reply.text = TRUNCATED_REPLY if is_cut else REFUSAL_REPLY
                return

            results = await self._run_tools(ctx, tool_uses, reply, on_tool)
            answered = StoredMessage(
                Role.USER, self._stub_results(results), estimate_tokens(results)
            )
            messages += [
                {"role": Role.ASSISTANT, "content": assistant.content},
                {"role": Role.USER, "content": results},
            ]
            self.store.append_messages(user_id, [assistant, answered])
        reply.text = reply.text or OUT_OF_STEPS_REPLY

    async def _call_model(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> Message:
        """The model's next step. Eager streaming can hand the SDK JSON it cannot parse at
        all (`ValueError`); there is nothing to answer then, so the call is re-issued."""
        attempts_left = JSON_RETRIES
        while True:
            try:
                return await self._stream(messages, tools)
            except ValueError:
                if attempts_left == 0:
                    raise
                attempts_left -= 1

    async def _run_tools(
        self,
        ctx: ToolContext,
        tool_uses: list[ToolUseBlock],
        reply: AgentReply,
        on_tool: OnTool | None,
    ) -> list[dict[str, Any]]:
        """Run the model's tool calls in order, recording what each did into `reply`; the
        result blocks to send back.

        In order, not at once: two requests in one step count against the quota the
        next one sees, and a picker the model asked for last is the one shown.
        """
        results = []
        for block in tool_uses:
            outcome = await self.runner.run(ctx, block.name, block.input)
            trace = ToolTrace(block.name, dict(block.input), not outcome.is_error, outcome.text)
            reply.tool_calls.append(trace)
            if on_tool:
                on_tool(trace)
            if isinstance(outcome.status, AwaitingConfirmation):
                reply.pending_ids.append(outcome.status.pending_id)
            if outcome.choices:  # the latest picker wins
                reply.choices = list(outcome.choices)
            reply.notices.extend(outcome.notices)
            seen = {t.key for t in reply.titles}
            reply.titles.extend(t for t in outcome.titles if t.key not in seen)
            results.append(outcome.as_result_block(block.id))
        return results

    async def _stream(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Message:
        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": MAX_TOKENS,
            "system": [
                {"type": "text", "text": self.system_prompt, "cache_control": {"type": "ephemeral"}}
            ],
            "messages": list(messages),
            "output_config": {"effort": self.effort},
            **({"tools": tools} if tools else {}),
        }
        async with self.client.messages.stream(**params) as stream:
            return await stream.get_final_message()

    @staticmethod
    def _text_of(response: Message) -> str:
        return "".join(b.text for b in response.content if isinstance(b, TextBlock)).strip()

    @staticmethod
    def _stub_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        def stub(result: dict[str, Any]) -> dict[str, Any]:
            content = result.get("content", "")
            if isinstance(content, str) and len(content) > STORED_RESULT_MAX_CHARS:
                return {
                    **result,
                    "content": content[:STORED_RESULT_MAX_CHARS] + " …[truncated in memory]",
                }
            return result

        return [stub(r) for r in results]
