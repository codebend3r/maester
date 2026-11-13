"""The chat logic, for whichever app shows sparrow.

Takes a message from a known chat user, resolves their tier, runs the
agent, and hands back text chunks plus whatever buttons the reply needs:
confirmations for destructive tools, a picker when a tool offered choices,
and notices (notes for the admin, DMs). Every Confirm or Cancel press lands
in `decide()`, which checks the presser is the requester, records the
decision, and runs the confirmed call through the agent. A run that failed
in a way worth retrying is reopened.

The service talks to no chat platform: the app that shows sparrow delivers
what it returns, and tests drive this class directly.
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass, field, replace
from typing import assert_never

from sparrow.agent.loop import Agent, OnTool, TurnFailed
from sparrow.agent.runner import AwaitingConfirmation, Cancelled, Done, Errored, may_decide
from sparrow.agent.tools import Choice, Tier, Title
from sparrow.chat.identity import IdentityService
from sparrow.chat.split import split_reply
from sparrow.notify import Notice
from sparrow.store import Decision as PressDecision
from sparrow.store import PendingAction, Store

log = logging.getLogger("sparrow.chat")

UNLINKED_HELP = (
    "Hi! I'm sparrow, the concierge for this Plex server. Your Plex account doesn't have "
    "access to it yet.\n\n"
    "Ask the admin or the friend who invited you for an invite. Once you're in, I'll know "
    "you the next time you write.\n\n"
    "Setting Plex up on a TV, stick or phone? There's a setup guide for each."
)
ERROR_REPLY = "Sorry, something went wrong on my end (ref `{ref}`). The admin can look it up."
NOT_WAITING = "That's no longer waiting."
STALE = "That action is no longer waiting."
EXPIRED = "That confirmation expired; ask again."
NOT_YOURS = "Only the person who asked can {verb} this."
CANCELLED = "Cancelled."
DONE = "Done: "
COULD_NOT = "Couldn't do it: {why}"
PRESS_AGAIN = "\nIt's still open, so you can press again."
# How much of what a run said a decision's reply keeps.
OUTCOME_CHARS = 1500


@dataclass(frozen=True)
class ChatUser:
    id: str
    name: str


@dataclass
class ChatResponse:
    chunks: list[str]
    confirmations: list[PendingAction] = field(default_factory=list)
    choices: list[Choice] = field(default_factory=list)
    notices: tuple[Notice, ...] = ()
    titles: tuple[Title, ...] = ()
    # Why the turn broke, for a caller that may show it (the sandbox); never for a friend.
    failure: str | None = None

    @property
    def text(self) -> str:
        return "\n".join(self.chunks)


@dataclass(frozen=True)
class Decision:
    """The answer to a button press.

    `settled` is False when the presser wasn't allowed to decide: the
    buttons stay live for the person who is.
    """

    text: str
    settled: bool = True
    notices: tuple[Notice, ...] = ()


@dataclass(frozen=True)
class Usage:
    model: str
    tokens_used: int | None
    token_budget: int | None


class ChatService:
    def __init__(self, *, agent: Agent, identity: IdentityService, store: Store):
        self.agent = agent
        self.identity = identity
        self.store = store

    def usage(self, user_id: str) -> Usage:
        """The model answering, and `user_id`'s tokens today against the daily budget
        (None for both without a limiter)."""
        limiter = self.agent.limiter
        return Usage(
            model=self.agent.model,
            tokens_used=limiter.used_today(user_id) if limiter else None,
            token_budget=limiter.tokens_per_day if limiter else None,
        )

    # -- messages ---------------------------------------------------------

    async def handle_message(
        self, user: ChatUser, text: str, *, on_tool: OnTool | None = None
    ) -> ChatResponse:
        """A turn: `user`'s message, answered at their tier. `on_tool` hears each tool call as
        it finishes."""
        tier = self.tier_for(user)
        if tier == Tier.UNLINKED:
            return ChatResponse(chunks=split_reply(UNLINKED_HELP))
        user_id = user.id
        failure = None
        try:
            reply = await self.agent.respond(user_id, tier, text, on_tool=on_tool)
        except TurnFailed as failed:
            ref = secrets.token_hex(3)
            log.exception("agent failed for user %s (ref %s)", user_id, ref)
            # What the turn's tools already did still reaches the user and the admin.
            reply = replace(failed.reply, text=ERROR_REPLY.format(ref=ref), choices=[], titles=[])
            cause = failed.__cause__
            failure = f"{type(cause).__name__}: {cause}" if cause else None

        confirmations = [p for p in (self.store.get_pending(i) for i in reply.pending_ids) if p]
        return ChatResponse(
            chunks=split_reply(reply.text),
            confirmations=confirmations,
            choices=reply.choices,
            notices=tuple(reply.notices),
            titles=tuple(reply.titles),
            failure=failure,
        )

    async def pick(
        self, user: ChatUser, choice: Choice, *, on_tool: OnTool | None = None
    ) -> ChatResponse:
        return await self.handle_message(
            user, f"I pick: {choice.display} ({choice.value})", on_tool=on_tool
        )

    # -- buttons ----------------------------------------------------------

    async def decide(self, pending_id: int, presser: ChatUser, approve: bool) -> Decision:
        """Settle a Confirm or Cancel press."""
        pending = self.store.get_pending(pending_id)
        if pending is None:
            return Decision(NOT_WAITING)
        if pending.decision is not None:
            return Decision(STALE)
        if not may_decide(pending, presser.id):
            verb = "confirm" if approve else "cancel"
            return Decision(NOT_YOURS.format(verb=verb), settled=False)

        decided = self.store.decide_pending(pending_id, PressDecision.of(approve), presser.id)
        if decided is None:
            return Decision(EXPIRED)
        outcome = await self.agent.run_decision(
            decided, presser.id, self.tier_for(presser), approve
        )
        said = outcome.text[:OUTCOME_CHARS]
        match outcome.status:
            case Cancelled():
                return Decision(CANCELLED, notices=outcome.notices)
            case Errored(retryable=True):
                self.store.reopen_pending(decided.id)
                return Decision(COULD_NOT.format(why=said) + PRESS_AGAIN, settled=False)
            case Errored():
                return Decision(COULD_NOT.format(why=said), notices=outcome.notices)
            case Done() | AwaitingConfirmation():
                return Decision(DONE + said, notices=outcome.notices)
            case _:
                assert_never(outcome.status)

    # -- commands ---------------------------------------------------------

    def forget(self, user: ChatUser) -> str:
        n = self.agent.forget(user.id)
        return "Forgotten. We're starting fresh." if n else "Nothing to forget."

    # -- tiers ------------------------------------------------------------

    def tier_for(self, user: ChatUser) -> Tier:
        return self.identity.tier_for(user.id)
