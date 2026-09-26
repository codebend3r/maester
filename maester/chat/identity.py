"""Who a chat account is on Plex/Seerr, and which tier they get.

Tier comes from Discord roles, resolved on every message so a role change
takes effect immediately, with a per-user override in the store that an
admin can set. Linking a Discord account to a Plex user is a two-step
flow: the friend names their Plex email or username, maester matches it
against Seerr's users, and the admin approves the link with a button.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from maester.agent.tools import Tier
from maester.store import PendingAction, UserRow

LINK_TTL = timedelta(days=7)


@dataclass(frozen=True)
class RoleMap:
    admin_role_id: int = 0
    trusted_role_id: int = 0


def resolve_tier(user: UserRow | None, role_ids: set[int], roles: RoleMap) -> Tier:
    """Override first, then roles; anyone not linked and active is UNLINKED.

    The admin role stands on its own: the server owner is an admin whether
    or not they bothered to link, since they administer the thing.
    """
    if user and user.tier_override:
        return Tier.parse(user.tier_override)
    if roles.admin_role_id and roles.admin_role_id in role_ids:
        return Tier.ADMIN
    if not user or user.status != "active":
        return Tier.UNLINKED
    if roles.trusted_role_id and roles.trusted_role_id in role_ids:
        return Tier.TRUSTED
    return Tier.FRIEND


@dataclass(frozen=True)
class LinkStart:
    ok: bool
    message: str
    pending: PendingAction | None = None


class IdentityService:
    def __init__(self, store: Any, services: Any, roles: RoleMap):
        self.store = store
        self.services = services
        self.roles = roles

    def tier_for(self, discord_id: str, role_ids: set[int]) -> Tier:
        return resolve_tier(self.store.get_user(discord_id), role_ids, self.roles)

    async def start_link(self, discord_id: str, display_name: str, query: str) -> LinkStart:
        """Match `query` (Plex email or username) against Seerr users and queue approval."""
        q = query.strip().lower()
        if not q:
            return LinkStart(
                False, "Tell me your Plex email or username, e.g. `/link me@example.com`."
            )
        existing = self.store.get_user(discord_id)
        if existing and existing.status == "active":
            return LinkStart(
                False, f"You're already linked as {existing.plex_email or existing.plex_username}."
            )
        if existing and existing.status == "pending" and self.store.open_pending("approve"):
            for p in self.store.open_pending("approve"):
                if p.action == "link_account" and p.requester == discord_id:
                    return LinkStart(False, "Your link request is already waiting for the admin.")

        users = await self.services.seerr.users()
        matches = [
            u for u in users if q in {u.email, u.username.lower(), u.plex_username.lower()} - {""}
        ]
        if not matches:
            return LinkStart(
                False,
                "I couldn't find that Plex account. Use the email or username you sign in to Plex with, "
                "or ask the admin for an invite if you don't have access yet.",
            )
        seerr_user = matches[0]
        tautulli_id = await self._tautulli_id(
            seerr_user.email, seerr_user.plex_username or seerr_user.username
        )
        self.store.upsert_user(
            discord_id,
            plex_email=seerr_user.email or None,
            plex_username=seerr_user.plex_username or seerr_user.username or None,
            seerr_user_id=seerr_user.id,
            tautulli_user_id=tautulli_id,
            status="pending",
        )
        pending = self.store.create_pending(
            kind="approve",
            action="link_account",
            requester=discord_id,
            payload={
                "discord_id": discord_id,
                "display_name": display_name,
                "seerr_user_id": seerr_user.id,
            },
            summary=f"Link Discord user {display_name} to Plex account {seerr_user.email or seerr_user.username}",
            ttl=LINK_TTL,
        )
        return LinkStart(
            True,
            f"Found {seerr_user.email or seerr_user.username}. The admin will confirm the link shortly.",
            pending,
        )

    async def _tautulli_id(self, email: str, username: str) -> int | None:
        tautullis = getattr(self.services, "tautulli", None) or {}
        for client in tautullis.values() if isinstance(tautullis, dict) else [tautullis]:
            try:
                for u in await client.users():
                    if (email and u.email == email) or (
                        username and u.username.lower() == username.lower()
                    ):
                        return u.user_id
            except Exception:  # a missing Tautulli must not block linking
                continue
        return None

    def approve_link(self, pending_id: int, admin_id: str) -> str:
        pending = self.store.decide_pending(pending_id, "approved", admin_id)
        if pending is None:
            return "That link request is no longer open."
        self.store.upsert_user(
            pending.requester, status="active", linked_at=datetime.now(UTC).isoformat()
        )
        return f"Linked: {pending.summary}"

    def deny_link(self, pending_id: int, admin_id: str) -> str:
        pending = self.store.decide_pending(pending_id, "denied", admin_id)
        if pending is None:
            return "That link request is no longer open."
        self.store.upsert_user(pending.requester, status="revoked")
        return f"Denied: {pending.summary}"

    def set_tier_override(self, discord_id: str, tier: str | None) -> str:
        normalized = Tier.parse(tier).name.lower() if tier else None
        self.store.upsert_user(discord_id, tier_override=normalized)
        return f"Tier for {discord_id} is now {normalized or 'from roles'}."

    def whoami(self, discord_id: str, role_ids: set[int]) -> str:
        user = self.store.get_user(discord_id)
        tier = resolve_tier(user, role_ids, self.roles)
        if not user or user.status == "revoked":
            return f"You're not linked yet (tier: {tier.name.lower()}). Use `/link <plex email or username>`."
        who = user.plex_email or user.plex_username or "?"
        state = "active" if user.status == "active" else "waiting for admin approval"
        return f"Linked to {who} ({state}). Tier: {tier.name.lower()}."
