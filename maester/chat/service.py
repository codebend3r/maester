"""The chat logic without any Discord in it.

Takes a message from a known chat user, resolves their tier, runs the
agent, and hands back text chunks plus whatever buttons the reply needs:
confirmations for destructive tools, a picker when a tool offered choices,
and admin approvals for link requests. `bot.py` turns those into Discord
messages and views; tests drive this class directly.
"""

from __future__ import annotations

import json
import logging
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from maester.agent.loop import STORED_RESULT_MAX_CHARS, Agent, estimate_tokens
from maester.agent.runner import CONFIRMED_KEY, ToolOutcome
from maester.agent.tools import Tier, ToolContext
from maester.chat.identity import IdentityService
from maester.chat.split import split_reply
from maester.store import PendingAction

log = logging.getLogger("maester.chat")

UNLINKED_HELP = (
    "Hi! I'm maester, the concierge for this Plex server. I don't know which Plex "
    "account is yours yet.\n\n"
    "If you already have access, link it with `/link <the email or username you use for Plex>` "
    "and the admin will approve it.\n\n"
    "If you don't have access yet, ask the friend who invited you here, or the admin, for an invite."
)
ERROR_REPLY = "Sorry, something went wrong on my end (ref `{ref}`). The admin can look it up."
MAX_CHOICES = 5


@dataclass(frozen=True)
class ChatUser:
    id: str
    name: str
    role_ids: frozenset[int] = frozenset()


@dataclass(frozen=True)
class Choice:
    label: str
    value: str
    year: int | None = None
    poster_url: str | None = None

    @property
    def display(self) -> str:
        if self.year and str(self.year) not in self.label:
            return f"{self.label} ({self.year})"
        return self.label


@dataclass
class ChatResponse:
    chunks: list[str]
    confirmations: list[PendingAction] = field(default_factory=list)
    choices: list[Choice] = field(default_factory=list)
    approvals: list[PendingAction] = field(default_factory=list)
    tier: Tier = Tier.UNLINKED

    @property
    def text(self) -> str:
        return "\n".join(self.chunks)


Notifier = Callable[[str, PendingAction | None], Awaitable[None]]


class ChatService:
    def __init__(
        self,
        *,
        agent: Agent,
        identity: IdentityService,
        store: Any,
        notify_admin: Notifier | None = None,
    ):
        self.agent = agent
        self.identity = identity
        self.store = store
        self.notify_admin = notify_admin

    # -- messages ---------------------------------------------------------

    async def handle_message(
        self, user: ChatUser, text: str, on_text: Callable[[str], Any] | None = None
    ) -> ChatResponse:
        tier = self.identity.tier_for(user.id, set(user.role_ids))
        if tier == Tier.UNLINKED:
            return ChatResponse(chunks=split_reply(UNLINKED_HELP), tier=tier)
        try:
            reply = await self.agent.respond(user.id, tier, text, on_text=on_text)
        except Exception:
            ref = secrets.token_hex(3)
            log.exception("agent failed for user %s (ref %s)", user.id, ref)
            return ChatResponse(chunks=[ERROR_REPLY.format(ref=ref)], tier=tier)

        confirmations = [p for p in (self.store.get_pending(i) for i in reply.pending_ids) if p]
        choices = [
            Choice(c["label"], c.get("value", c["label"]), c.get("year"), c.get("poster_url"))
            for c in reply.choices[:MAX_CHOICES]
        ]
        return ChatResponse(
            chunks=split_reply(reply.text), confirmations=confirmations, choices=choices, tier=tier
        )

    async def pick(self, user: ChatUser, choice: Choice) -> ChatResponse:
        return await self.handle_message(user, f"I pick: {choice.display} ({choice.value})")

    # -- confirmations ----------------------------------------------------

    async def confirm(self, pending_id: int, presser: ChatUser) -> str:
        pending = self.store.get_pending(pending_id)
        if pending is None or pending.decision is not None:
            return "That action is no longer waiting."
        if pending.requester != presser.id:
            return "Only the person who asked can confirm this."
        if self.store.decide_pending(pending_id, "approved", presser.id) is None:
            return "That confirmation expired; ask again."
        tier = self.identity.tier_for(presser.id, set(presser.role_ids))
        ctx = ToolContext(
            user_id=presser.id, tier=tier, services=self.agent.services, store=self.store
        )
        outcome = await self.agent.runner.run(
            ctx, pending.action, {**pending.payload, CONFIRMED_KEY: pending_id}
        )
        content = (
            outcome.content
            if isinstance(outcome.content, str)
            else json.dumps(outcome.content, default=str)
        )
        self._remember_button(presser.id, pending, outcome)
        if self.notify_admin:
            await self.notify_admin(
                f"{presser.name} confirmed: {pending.summary}\n{content[:500]}", None
            )
        return ("Couldn't do it: " if outcome.is_error else "Done: ") + content[:1500]

    async def cancel(self, pending_id: int, presser: ChatUser) -> str:
        pending = self.store.get_pending(pending_id)
        if pending is None or pending.decision is not None:
            return "That action is no longer waiting."
        if pending.requester != presser.id:
            return "Only the person who asked can cancel this."
        self.store.decide_pending(pending_id, "denied", presser.id)
        self._remember_button(
            presser.id, pending, ToolOutcome("Cancelled by the user; nothing was done.")
        )
        return "Cancelled."

    def _remember_button(self, user_id: str, pending: PendingAction, outcome: ToolOutcome) -> None:
        """Record a button press as a tool call and its result in the user's memory.

        The model's own call only got a "waiting for confirmation" result, so
        the real outcome goes in as a fresh tool_use/tool_result pair; the next
        turn sees what happened the same way it sees any other tool.
        """
        tool_use = {
            "type": "tool_use",
            "id": f"toolu_button_{pending.id}",
            "name": pending.action,
            "input": pending.payload,
        }
        result = outcome.as_result_block(tool_use["id"])
        result["content"] = result["content"][:STORED_RESULT_MAX_CHARS]
        self.store.append_message(user_id, "assistant", [tool_use], estimate_tokens(tool_use))
        self.store.append_message(user_id, "user", [result], estimate_tokens(result))

    # -- commands ---------------------------------------------------------

    async def link(self, user: ChatUser, query: str) -> ChatResponse:
        result = await self.identity.start_link(user.id, user.name, query)
        approvals = [result.pending] if result.pending else []
        if result.pending and self.notify_admin:
            await self.notify_admin(f"Link request: {result.pending.summary}", result.pending)
        return ChatResponse(chunks=[result.message], approvals=approvals)

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

    # -- admin approvals --------------------------------------------------

    def is_admin(self, user: ChatUser) -> bool:
        return self.identity.tier_for(user.id, set(user.role_ids)) == Tier.ADMIN

    async def approve(self, pending_id: int, admin: ChatUser) -> str:
        if not self.is_admin(admin):
            return "Only the admin can approve this."
        pending = self.store.get_pending(pending_id)
        if pending is None or pending.decision is not None:
            return "That request is no longer open."
        if pending.action == "link_account":
            return self.identity.approve_link(pending_id, admin.id)
        # Other approval kinds (4K requests, invites) land with the admin console epic.
        decided = self.store.decide_pending(pending_id, "approved", admin.id)
        return f"Approved: {decided.summary}" if decided else "That request expired."

    async def deny(self, pending_id: int, admin: ChatUser) -> str:
        if not self.is_admin(admin):
            return "Only the admin can deny this."
        pending = self.store.get_pending(pending_id)
        if pending is None or pending.decision is not None:
            return "That request is no longer open."
        if pending.action == "link_account":
            return self.identity.deny_link(pending_id, admin.id)
        decided = self.store.decide_pending(pending_id, "denied", admin.id)
        return f"Denied: {decided.summary}" if decided else "That request expired."
