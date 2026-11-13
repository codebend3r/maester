"""The admin's one command the deployed app offers: setting a user's tier override.

It is the admin's alone and is audited under its own name ("/tier"),
refusals included, so the log shows who tried what. Like the chat service,
the console talks to no chat platform: `POST /api/admin/users/{id}/tier`
(`sparrow/web/api.py`) offers it and returns the reply.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sparrow.agent.tools import Tier
from sparrow.chat.identity import IdentityService
from sparrow.chat.service import ChatUser
from sparrow.store import Store

COMMAND = "tier"
NOT_ADMIN = f"Only the admin can use /{COMMAND}."
UNKNOWN_TIER = "Unknown tier `{tier}`; use friend, trusted, or admin."


@dataclass(frozen=True)
class AdminReply:
    text: str


class AdminConsole:
    def __init__(self, *, identity: IdentityService, store: Store):
        self.identity = identity
        self.store = store

    def _audit(self, user: ChatUser, args: dict[str, Any], reply: str, ok: bool) -> None:
        self.store.audit(user_id=user.id, tool=f"/{COMMAND}", args=args, result=reply, ok=ok)

    def set_tier(self, admin: ChatUser, target_id: str, tier: str | None) -> AdminReply:
        args = {"target": target_id, "tier": tier}
        if self.identity.tier_for(admin.id) != Tier.ADMIN:
            self._audit(admin, args, NOT_ADMIN, ok=False)
            return AdminReply(NOT_ADMIN)
        try:
            text = self.identity.set_tier_override(target_id, tier)
        except ValueError:
            text = UNKNOWN_TIER.format(tier=tier)
            self._audit(admin, args, text, ok=False)
            return AdminReply(text)
        self._audit(admin, args, text, ok=True)
        return AdminReply(text)
