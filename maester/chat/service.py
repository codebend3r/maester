"""The chat logic without any Discord in it.

Takes a message from a known chat user, resolves their tier, runs the
agent, and hands back text chunks plus whatever buttons the reply needs:
confirmations for destructive tools, a picker when a tool offered choices,
and notices (admin posts, approvals, DMs). Every button press lands in
`decide()`, which owns who may press what, records the decision, and runs
what it decided through the agent: the confirmed call, or the admin tool an
approval named. The two kinds differ only in who presses and how it reads
(`KINDS`). A run that failed in a way worth retrying is reopened.

A DM about a title is remembered by message id (`remember_dm`), so a
reaction to it can mean something: a thumbs-down on "Dune is ready" becomes
a message saying something's wrong with that copy, and the report flow
starts from there (`react`). The service talks to no chat platform:
`bot.py` delivers what it returns, and tests drive this class directly.
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass, field, replace

from maester.agent.loop import Agent, TurnFailed
from maester.agent.runner import CANCELLED
from maester.agent.tools import Choice, Tier
from maester.chat.identity import IdentityService
from maester.chat.split import split_reply
from maester.notify import ApprovalPost, DirectMessage, Notice
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
ESCALATED = "That needs the admin's approval now; you'll get a DM once they decide."
# A thumbs-down (any skin tone) on a DM about a title reports a problem with it.
THUMBS_DOWN = "\N{THUMBS DOWN SIGN}"


def reports_a_problem(emoji: str) -> bool:
    """Whether a reaction means anything at all, before anyone is looked up."""
    return emoji.startswith(THUMBS_DOWN)


REACTION_REPORT = (
    "{emoji} on your message about {title} in {version} ({media_type} {tmdb_id}): "
    "something's wrong with it."
)


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

    # -- DMs and reactions ------------------------------------------------

    def remember_dm(self, message_id: str, dm: DirectMessage) -> None:
        """Note what a sent DM was about, when it was about a title."""
        if dm.about is not None:
            self.store.remember_message(message_id, dm.to, dm.about)

    async def react(self, user: ChatUser, message_id: str, emoji: str) -> ChatResponse | None:
        """A reaction to one of maester's DMs; None when it means nothing."""
        if not reports_a_problem(emoji):
            return None
        about = self.store.message_about(message_id, user.id)
        if about is None:
            return None
        text = REACTION_REPORT.format(
            emoji=emoji,
            title=about.title,
            version=about.copy.version,
            media_type=about.copy.media_type,
            tmdb_id=about.copy.tmdb_id,
        )
        return await self.handle_message(user, text)

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
        if outcome.is_error and outcome.retryable:
            self.store.reopen_pending(decided.id)
            return Decision(
                f"Couldn't do it: {outcome.text[:1500]}\nIt's still open, so you can press again.",
                settled=False,
            )
        if outcome.is_error:
            return Decision(f"Couldn't do it: {outcome.text[:1500]}", notices=outcome.notices)
        return Decision(kind.done + outcome.text[:1500], notices=outcome.notices)

    def _may_decide(self, pending: PendingAction, presser: ChatUser) -> bool:
        if pending.kind == "confirm":
            return pending.requester == presser.id
        return self.is_admin(presser)

    # -- commands ---------------------------------------------------------

    async def link(self, user: ChatUser, query: str) -> ChatResponse:
        result = await self.identity.start_link(user.id, user.name, query)
        notices = ()
        if result.pending:
            notices = (ApprovalPost(f"Link request: {result.pending.summary}", result.pending.id),)
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
