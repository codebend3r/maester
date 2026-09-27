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

from maester.agent.tools import Settled, Tier
from maester.clients import Services
from maester.notify import DirectMessage
from maester.store import LinkStatus, PendingAction, Store

LINK_TTL = timedelta(days=7)


@dataclass(frozen=True)
class RoleMap:
    admin_role_id: int = 0
    trusted_role_id: int = 0


def resolve_tier(override: str | None, linked: bool, role_ids: set[int], roles: RoleMap) -> Tier:
    """Override first, then roles; anyone without an active link is UNLINKED.

    The admin role stands on its own: the server owner is an admin whether
    or not they bothered to link, since they administer the thing.
    """
    if override:
        return Tier.parse(override)
    if roles.admin_role_id and roles.admin_role_id in role_ids:
        return Tier.ADMIN
    if not linked:
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
    def __init__(self, store: Store, services: Services, roles: RoleMap):
        self.store = store
        self.services = services
        self.roles = roles

    def tier_for(self, discord_id: str, role_ids: set[int]) -> Tier:
        user = self.store.get_user(discord_id)
        linked = self.store.active_link(discord_id) is not None
        return resolve_tier(user.tier_override if user else None, linked, role_ids, self.roles)

    async def start_link(self, discord_id: str, display_name: str, query: str) -> LinkStart:
        """Match `query` (Plex email or username) against Seerr users and queue approval."""
        q = query.strip().lower()
        if not q:
            return LinkStart(
                False, "Tell me your Plex email or username, e.g. `/link me@example.com`."
            )
        existing = self.store.get_user(discord_id)
        if existing and existing.status == LinkStatus.ACTIVE:
            return LinkStart(
                False, f"You're already linked as {existing.plex_email or existing.plex_username}."
            )
        if self.store.open_pending("approve", action="link_account", requester=discord_id):
            return LinkStart(False, "Your link request is already waiting for the admin.")

        users = await self.services.seerr.users()
        matches = [
            u
            for u in users
            if q in {u.email.lower(), u.username.lower(), u.plex_username.lower()} - {""}
        ]
        if not matches:
            return LinkStart(
                False,
                "I couldn't find that Plex account. Use the email or username you sign in to Plex with, "
                "or ask the admin for an invite if you don't have access yet.",
            )
        seerr_user = matches[0]
        holder = self.store.user_by_seerr_id(seerr_user.id)
        if holder is not None and holder.discord_id != discord_id:
            # One Discord account per Plex account, so requests and ready DMs
            # can only belong to one person.
            return LinkStart(
                False,
                "That Plex account is already linked to another Discord account. "
                "Ask the admin if it should be yours.",
            )
        tautulli_id = await self._tautulli_id(
            seerr_user.email, seerr_user.plex_username or seerr_user.username
        )
        self.store.upsert_user(
            discord_id,
            plex_email=seerr_user.email or None,
            plex_username=seerr_user.plex_username or seerr_user.username or None,
            seerr_user_id=seerr_user.id,
            tautulli_user_id=tautulli_id,
            status=LinkStatus.PENDING,
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
        for client in self.services.tautulli.values():
            try:
                for u in await client.users():
                    if (email and u.email.lower() == email.lower()) or (
                        username and u.username.lower() == username.lower()
                    ):
                        return u.user_id
            except Exception:  # a missing Tautulli must not block linking
                continue
        return None

    async def finish_link(self, pending: PendingAction, approved: bool) -> Settled:
        """Apply an admin's already-recorded decision on a link request, and tell the friend."""
        if approved:
            self.store.upsert_user(
                pending.requester, status=LinkStatus.ACTIVE, linked_at=datetime.now(UTC).isoformat()
            )
            dm = "You're linked! Ask me for movies and shows any time."
            return Settled(f"Linked: {pending.summary}", (DirectMessage(pending.requester, dm),))
        self.store.upsert_user(pending.requester, status=LinkStatus.REVOKED)
        dm = "The admin didn't approve that link. Ask them if you think it's a mistake."
        return Settled(f"Denied: {pending.summary}", (DirectMessage(pending.requester, dm),))

    def set_tier_override(self, discord_id: str, tier: str | None) -> str:
        normalized = Tier.parse(tier).name.lower() if tier else None
        self.store.upsert_user(discord_id, tier_override=normalized)
        return f"Tier for {discord_id} is now {normalized or 'from roles'}."

    def whoami(self, discord_id: str, role_ids: set[int]) -> str:
        user = self.store.get_user(discord_id)
        tier = self.tier_for(discord_id, role_ids)
        if not user or user.status == LinkStatus.REVOKED:
            return f"You're not linked yet (tier: {tier.name.lower()}). Use `/link <plex email or username>`."
        who = user.plex_email or user.plex_username or "?"
        state = "active" if user.status == LinkStatus.ACTIVE else "waiting for admin approval"
        return f"Linked to {who} ({state}). Tier: {tier.name.lower()}."
