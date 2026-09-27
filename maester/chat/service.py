"""The chat logic without any Discord in it.

Takes a message from a known chat user, resolves their tier, runs the
agent, and hands back text chunks plus whatever buttons the reply needs:
confirmations for destructive tools, a picker when a tool offered choices,
and notices (admin posts, approvals, DMs). Every button press lands in
`decide()`, which owns who may press what. An admin's decision is applied
by the handler registered for its action: the link flow's own, or the
`settle` handler of the tool that raised it. The service talks to no chat
platform: `bot.py` delivers what it returns, and tests drive this class
directly.
"""

from __future__ import annotations

import logging
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace

from maester.agent.loop import Agent, TurnFailed
from maester.agent.tools import Choice, Settled, Tier
from maester.chat.identity import IdentityService
from maester.chat.split import split_reply
from maester.notify import Notice
from maester.store import PendingAction, Store

log = logging.getLogger("maester.chat")

UNLINKED_HELP = (
    "Hi! I'm maester, the concierge for this Plex server. I don't know which Plex "
    "account is yours yet.\n\n"
    "If you already have access, link it with `/link <the email or username you use for Plex>` "
    "and the admin will approve it.\n\n"
    "If you don't have access yet, ask the friend who invited you here, or the admin, for an invite."
)
ERROR_REPLY = "Sorry, something went wrong on my end (ref `{ref}`). The admin can look it up."
SETTLE_FAILED = "Couldn't finish that (ref `{ref}`); it's still open, so you can press again."


@dataclass(frozen=True)
class ChatUser:
    id: str
    name: str
    role_ids: frozenset[int] = frozenset()


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


KINDS = {
    "confirm": _Kind(
        "the person who asked",
        ("confirm", "cancel"),
        "That action is no longer waiting.",
        "That confirmation expired; ask again.",
    ),
    "approve": _Kind(
        "the admin",
        ("approve", "deny"),
        "That request is no longer open.",
        "That request expired.",
    ),
}


ApprovalHandler = Callable[[PendingAction, bool], Awaitable[Settled]]


class ChatService:
    def __init__(self, *, agent: Agent, identity: IdentityService, store: Store):
        self.agent = agent
        self.identity = identity
        self.store = store
        # What an admin's decision does, by action. Actions not listed here
        # were raised by a tool, and that tool's `settle` handler applies them.
        self._on_approval: dict[str, ApprovalHandler] = {
            "link_account": identity.finish_link,
        }

    # -- messages ---------------------------------------------------------

    async def handle_message(self, user: ChatUser, text: str) -> ChatResponse:
        tier = self.tier_for(user)
        if tier == Tier.UNLINKED:
            return ChatResponse(chunks=split_reply(UNLINKED_HELP))
        try:
            reply = await self.agent.respond(user.id, tier, text)
        except TurnFailed as failed:
            ref = secrets.token_hex(3)
            log.exception("agent failed for user %s (ref %s)", user.id, ref)
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
        if decided.kind == "approve":
            return await self._settle(decided, approve)
        return await self._run_confirmation(decided, presser, approve)

    def _may_decide(self, pending: PendingAction, presser: ChatUser) -> bool:
        if pending.kind == "confirm":
            return pending.requester == presser.id
        return self.is_admin(presser)

    async def _settle(self, pending: PendingAction, approve: bool) -> Decision:
        """Apply an admin's decision; when that fails, reopen it so they can press again."""
        settle = self._on_approval.get(pending.action, self.agent.settle_approval)
        try:
            settled = await settle(pending, approve)
        except Exception:
            ref = secrets.token_hex(3)
            log.exception("settling %s %s failed (ref %s)", pending.action, pending.id, ref)
            self.store.reopen_pending(pending.id)
            return Decision(SETTLE_FAILED.format(ref=ref), settled=False)
        return Decision(settled.text, notices=settled.notices)

    async def _run_confirmation(
        self, pending: PendingAction, presser: ChatUser, approve: bool
    ) -> Decision:
        outcome = await self.agent.resolve_confirmation(
            presser.id, self.tier_for(presser), pending, approve
        )
        if not approve:
            return Decision("Cancelled.")
        notice = Notice(f"{presser.name} confirmed: {pending.summary}\n{outcome.text[:500]}")
        prefix = "Couldn't do it: " if outcome.is_error else "Done: "
        return Decision(prefix + outcome.text[:1500], notices=(notice, *outcome.notices))

    # -- commands ---------------------------------------------------------

    async def link(self, user: ChatUser, query: str) -> ChatResponse:
        result = await self.identity.start_link(user.id, user.name, query)
        notices = ()
        if result.pending:
            notices = (Notice(f"Link request: {result.pending.summary}", approval=result.pending),)
        return ChatResponse(chunks=[result.message], notices=notices)

    def whoami(self, user: ChatUser) -> str:
        return self.identity.whoami(user.id, set(user.role_ids))

    def forget(self, user: ChatUser) -> str:
        n = self.agent.forget(user.id)
        return "Forgotten. We're starting fresh." if n else "Nothing to forget."

    async def set_tier(self, admin: ChatUser, target_id: str, tier: str | None) -> str:
        if not self.is_admin(admin):
            return "Only the admin can change tiers."
        try:
            text = self.identity.set_tier_override(target_id, tier)
        except ValueError:
            return f"Unknown tier `{tier}`; use friend, trusted, or admin."
        self.store.audit(
            discord_id=admin.id,
            tool="set_tier",
            args={"target": target_id, "tier": tier},
            result=text,
            ok=True,
        )
        return text

    # -- tiers ------------------------------------------------------------

    def tier_for(self, user: ChatUser) -> Tier:
        return self.identity.tier_for(user.id, set(user.role_ids))

    def is_admin(self, user: ChatUser) -> bool:
        return self.tier_for(user) == Tier.ADMIN
