"""Who a chat account is on Plex/Seerr, and which tier they get.

Tier is resolved on every message, so a change takes effect immediately: a
stored override, which an admin sets, wins; otherwise an account linked to a
Seerr user is a friend, and anyone else is unlinked. Trusted and admin come
only from the override. Linking a chat account to a Plex user is a two-step
flow: the friend names their Plex email or username, luwin matches it
against Seerr's users, and the admin decides, which runs the
`link_account` admin tool.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from luwin.agent.tools import Tier
from luwin.clients import Services
from luwin.store import LinkStatus, PendingAction, SeerrUserTaken, Store

LINK_TTL = timedelta(days=7)
ALREADY_LINKED = (
    "That Plex account is already linked to another account here. "
    "Ask the admin if it should be yours."
)


def resolve_tier(override: str | None, linked: bool) -> Tier:
    """The stored override first; otherwise a linked account is a friend, anyone else UNLINKED.

    An admin override stands on its own: the admin is an admin whether or not
    they bothered to link, since they administer the thing.
    """
    if override:
        return Tier.parse(override)
    return Tier.FRIEND if linked else Tier.UNLINKED


@dataclass(frozen=True)
class LinkStart:
    ok: bool
    message: str
    pending: PendingAction | None = None


class IdentityService:
    def __init__(self, store: Store, services: Services):
        self.store = store
        self.services = services

    def tier_for(self, user_id: str) -> Tier:
        user = self.store.get_user(user_id)
        linked = self.store.active_link(user_id) is not None
        return resolve_tier(user.tier_override if user else None, linked)

    async def start_link(self, user_id: str, display_name: str, query: str) -> LinkStart:
        """Match `query` (Plex email or username) against Seerr users and queue approval."""
        q = query.strip().lower()
        if not q:
            return LinkStart(False, "Tell me your Plex email or username, e.g. me@example.com.")
        existing = self.store.get_user(user_id)
        if existing and existing.status == LinkStatus.ACTIVE:
            return LinkStart(
                False, f"You're already linked as {existing.plex_email or existing.plex_username}."
            )
        if self.store.open_pending("approve", action="link_account", requester=user_id):
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
        # One chat account per Plex account, so requests and ready DMs can
        # only belong to one person. The schema enforces it; this check only
        # answers early and kindly.
        holder = self.store.user_by_seerr_id(seerr_user.id)
        if holder is not None and holder.user_id != user_id:
            return LinkStart(False, ALREADY_LINKED)
        tautulli_id = await self._tautulli_id(
            seerr_user.email, seerr_user.plex_username or seerr_user.username
        )
        try:
            self.store.upsert_user(
                user_id,
                plex_email=seerr_user.email or None,
                plex_username=seerr_user.plex_username or seerr_user.username or None,
                seerr_user_id=seerr_user.id,
                tautulli_user_id=tautulli_id,
                status=LinkStatus.PENDING,
            )
        except SeerrUserTaken:  # someone else linked it while we asked Tautulli
            return LinkStart(False, ALREADY_LINKED)
        account = seerr_user.email or seerr_user.username
        # Decided by the button-only `link_account` admin tool (luwin/tools/accounts.py).
        pending = self.store.create_pending(
            kind="approve",
            action="link_account",
            requester=user_id,
            payload={"user_id": user_id, "display_name": display_name, "account": account},
            summary=f"Link {display_name} to Plex account {account}",
            ttl=LINK_TTL,
        )
        return LinkStart(
            True,
            f"Found {account}. The admin will confirm the link shortly.",
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

    def set_tier_override(self, user_id: str, tier: str | None) -> str:
        normalized = Tier.parse(tier).name.lower() if tier else None
        self.store.upsert_user(user_id, tier_override=normalized)
        return f"Tier for {user_id} is now {normalized or 'the default'}."

    def whoami(self, user_id: str) -> str:
        user = self.store.get_user(user_id)
        tier = self.tier_for(user_id)
        if not user or user.status == LinkStatus.REVOKED:
            return (
                f"You're not linked yet (tier: {tier.name.lower()}). Link the email or "
                "username you use for Plex and the admin will approve it."
            )
        who = user.plex_email or user.plex_username or "?"
        state = "active" if user.status == LinkStatus.ACTIVE else "waiting for admin approval"
        return f"Linked to {who} ({state}). Tier: {tier.name.lower()}."
