"""The chat logic, for whichever app shows luwin.

Takes a message from a known chat user, resolves their tier, runs the
agent, and hands back text chunks plus whatever buttons the reply needs:
confirmations for destructive tools, a picker when a tool offered choices,
and notices (admin posts, approvals, DMs). Every button press lands in
`decide()`, which owns who may press what, records the decision, and runs
what it decided through the agent: the confirmed call, or the admin tool an
approval named. The two kinds differ only in who presses and how it reads
(`KINDS`). A run that failed in a way worth retrying is reopened.

The service talks to no chat platform: the app that shows luwin delivers
what it returns, and tests drive this class directly.
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass, field, replace

from luwin.agent.loop import Agent, TurnFailed
from luwin.agent.runner import CANCELLED
from luwin.agent.tools import Choice, Tier
from luwin.chat.identity import IdentityService
from luwin.chat.split import split_reply
from luwin.guides import guide
from luwin.notify import Notice
from luwin.store import PendingAction, Store

log = logging.getLogger("luwin.chat")

UNLINKED_HELP = (
    "Hi! I'm luwin, the concierge for this Plex server. Your Plex account doesn't have "
    "access to it yet.\n\n"
    "Ask the admin or the friend who invited you for an invite. Once you're in, I'll know "
    "you the next time you write.\n\n"
    "Setting Plex up on a TV, stick or phone? There's a setup guide for each."
)
ERROR_REPLY = "Sorry, something went wrong on my end (ref `{ref}`). The admin can look it up."
ESCALATED = "That needs the admin's approval now; you'll hear back once they decide."
HELD = (
    "The server is down for maintenance, so that's saved: it runs once maintenance is over, "
    "and I'll let you know how it went."
)


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
class _Kind:
    """How a kind of pending action reads to the people pressing its buttons."""

    decider: str
    verbs: tuple[str, str]  # (approve, deny)
    stale: str
    expired: str
    done: str  # put before what the run said, once it went through


KINDS = {
    "confirm": _Kind(
        "the person who asked",
        ("confirm", "cancel"),
        "That action is no longer waiting.",
        "That confirmation expired; ask again.",
        "Done: ",
    ),
    "approve": _Kind(
        "the admin",
        ("approve", "deny"),
        "That request is no longer open.",
        "That request expired.",
        "",
    ),
}


class ChatService:
    def __init__(self, *, agent: Agent, identity: IdentityService, store: Store):
        self.agent = agent
        self.identity = identity
        self.store = store

    # -- messages ---------------------------------------------------------

    async def handle_message(self, user: ChatUser, text: str) -> ChatResponse:
        tier = self.tier_for(user)
        if tier == Tier.UNLINKED:
            return ChatResponse(chunks=split_reply(UNLINKED_HELP))
        return await self.follow_up(user.id, tier, text)

    async def follow_up(self, user_id: str, tier: Tier, text: str) -> ChatResponse:
        """A turn as `user_id` at `tier`: their message, or one the server starts for them
        (what they asked for during maintenance has run)."""
        try:
            reply = await self.agent.respond(user_id, tier, text)
        except TurnFailed as failed:
            ref = secrets.token_hex(3)
            log.exception("agent failed for user %s (ref %s)", user_id, ref)
            # What the turn's tools already did still reaches the user and the admin.
            reply = replace(failed.reply, text=ERROR_REPLY.format(ref=ref), choices=[])

        confirmations = [p for p in (self.store.get_pending(i) for i in reply.pending_ids) if p]
        return ChatResponse(
            chunks=split_reply(reply.text),
            confirmations=confirmations,
            choices=reply.choices,
            notices=tuple(reply.notices),
        )

    async def pick(self, user: ChatUser, choice: Choice) -> ChatResponse:
        return await self.handle_message(user, f"I pick: {choice.display} ({choice.value})")

    # -- buttons ----------------------------------------------------------

    async def decide(self, pending_id: int, presser: ChatUser, approve: bool) -> Decision:
        """Settle a Confirm/Cancel or Approve/Deny press."""
        pending = self.store.get_pending(pending_id)
        if pending is None:
            return Decision("That's no longer waiting.")
        kind = KINDS[pending.kind]
        if pending.decision is not None:
            return Decision(kind.stale)
        if not self._may_decide(pending, presser):
            verb = kind.verbs[0 if approve else 1]
            return Decision(f"Only {kind.decider} can {verb} this.", settled=False)

        decided = self.store.decide_pending(
            pending_id, "approved" if approve else "denied", presser.id
        )
        if decided is None:
            return Decision(kind.expired)
        outcome = await self.agent.run_decision(
            decided, presser.id, self.tier_for(presser), approve
        )
        if outcome is CANCELLED:
            return Decision("Cancelled.", notices=outcome.notices)
        if outcome.approval_id is not None:  # the confirmed action went to the admin instead
            return Decision(ESCALATED, notices=outcome.notices)
        if outcome.held_id is not None:
            return Decision(HELD)
        if outcome.is_error and outcome.retryable:
            if self.store.reopen_pending(decided.id):
                return Decision(
                    f"Couldn't do it: {outcome.text[:1500]}\nIt's still open, so you can press "
                    "again.",
                    settled=False,
                )
            return Decision(
                f"Couldn't do it: {outcome.text[:1500]}\nA newer approval for the same thing is "
                "open; use that one.",
                notices=outcome.notices,
            )
        if outcome.is_error:
            return Decision(f"Couldn't do it: {outcome.text[:1500]}", notices=outcome.notices)
        return Decision(kind.done + outcome.text[:1500], notices=outcome.notices)

    def _may_decide(self, pending: PendingAction, presser: ChatUser) -> bool:
        if pending.kind == "confirm":
            return pending.requester == presser.id
        return self.is_admin(presser)

    # -- commands ---------------------------------------------------------

    def setup_guide(self, device: str) -> list[str]:
        """A device's setup guide, for anyone, linked or not; in chunks that fit a message."""
        return split_reply(guide(device))

    def forget(self, user: ChatUser) -> str:
        n = self.agent.forget(user.id)
        return "Forgotten. We're starting fresh." if n else "Nothing to forget."

    # -- tiers ------------------------------------------------------------

    def tier_for(self, user: ChatUser) -> Tier:
        return self.identity.tier_for(user.id)

    def is_admin(self, user: ChatUser) -> bool:
        return self.tier_for(user) == Tier.ADMIN
