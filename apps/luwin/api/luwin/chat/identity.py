"""Who a signed-in user is on Plex/Seerr, and which tier they get.

rookery says who someone is: their rookery user id and the Plex account they
signed in with. luwin decides what they may do. Tier is resolved on every
request, so a change takes effect immediately: a stored override, which the
admin sets, wins; then the owner of the Plex server is the admin; then a
user whose Plex account matches a Seerr user is a friend; anyone else is
unlinked. Trusted comes only from the override.

The Seerr match, and the Tautulli user id beside it, are cached on the
user's row and checked again when due: daily once matched, so a friend Seerr
no longer lists loses access, and at most once a minute while unmatched, so
a friend invited a minute ago gets in on their next message. Only verified
Plex facts match: the account's email against a Seerr user's email, and its
Plex username against a Seerr user's Plex username, never a display name a
local Seerr user chose.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from luwin.agent.tools import Tier
from luwin.clients import Account, ClientError, PlexAccount, Services
from luwin.store import Store, UserRow
from luwin.store.base import stamp

log = logging.getLogger("luwin.identity")

MATCHED_RECHECK = timedelta(days=1)
UNMATCHED_RECHECK = timedelta(minutes=1)
OWNER_RETRY = timedelta(minutes=1)


def resolve_tier(override: str | None, *, owner: bool, linked: bool) -> Tier:
    """The stored override first; then the server's owner is the admin; then a linked user
    is a friend, and anyone else UNLINKED."""
    if override:
        return Tier.parse(override)
    if owner:
        return Tier.ADMIN
    return Tier.FRIEND if linked else Tier.UNLINKED


def _utcnow() -> datetime:
    return datetime.now(UTC)


class IdentityService:
    def __init__(
        self, store: Store, services: Services, *, clock: Callable[[], datetime] = _utcnow
    ):
        self.store = store
        self.services = services
        self.clock = clock
        # The Plex server's owner, once plex.tv has said; see `load_owner`.
        self.owner: PlexAccount | None = None
        self._owner_asked: datetime | None = None

    async def load_owner(self) -> PlexAccount | None:
        """The server's owner: `PLEX_TOKEN`'s account on plex.tv. Asked once at boot, and
        again at most once a minute while plex.tv couldn't say, so a blip at boot doesn't
        leave luwin without its admin."""
        plextv = getattr(self.services, "plextv", None)
        if self.owner is not None or plextv is None:
            return self.owner
        now = self.clock()
        if self._owner_asked is not None and now - self._owner_asked < OWNER_RETRY:
            return None
        self._owner_asked = now
        try:
            self.owner = await plextv.account()
        except ClientError:
            log.warning("plex.tv couldn't say who owns the server; asking again in a minute")
        return self.owner

    def tier_for(self, user_id: str) -> Tier:
        user = self.store.get_user(user_id)
        if user is None:
            return Tier.UNLINKED
        owner = self.owner is not None and user.plex_id == self.owner.id
        return resolve_tier(user.tier_override, owner=owner, linked=user.seerr_user_id is not None)

    async def refresh(self, account: Account) -> UserRow:
        """The user `account` names, upserted from it, with their Seerr match checked when due."""
        now = self.clock()
        user = self.store.upsert_user(
            account.user_id,
            plex_id=account.plex_id,
            plex_email=account.plex_email or None,
            plex_username=account.plex_username or None,
            thumb=account.thumb or None,
            last_seen_at=stamp(now),
        )
        if self._match_due(user, now):
            user = await self._match(user, now)
        return user

    @staticmethod
    def _match_due(user: UserRow, now: datetime) -> bool:
        if user.seerr_checked_at is None:
            return True
        wait = MATCHED_RECHECK if user.seerr_user_id is not None else UNMATCHED_RECHECK
        return now - datetime.fromisoformat(user.seerr_checked_at) >= wait

    async def _match(self, user: UserRow, now: datetime) -> UserRow:
        checked = stamp(now)
        try:
            seerr_users = await self.services.seerr.users()
        except ClientError:
            # Keep whatever match they had; the next check is due as usual.
            log.warning("Seerr couldn't list its users to match %s", user.user_id)
            return self.store.upsert_user(user.user_id, seerr_checked_at=checked)
        email = (user.plex_email or "").lower()
        username = (user.plex_username or "").lower()
        match = next(
            (
                u
                for u in seerr_users
                if (email and u.email.lower() == email)
                or (username and u.plex_username.lower() == username)
            ),
            None,
        )
        if match is None:
            return self.store.upsert_user(
                user.user_id, seerr_user_id=None, tautulli_user_id=None, seerr_checked_at=checked
            )
        tautulli_id = await self._tautulli_id(email, username)
        return self.store.upsert_user(
            user.user_id,
            seerr_user_id=match.id,
            tautulli_user_id=tautulli_id,
            seerr_checked_at=checked,
        )

    async def _tautulli_id(self, email: str, username: str) -> int | None:
        for client in self.services.tautulli.values():
            try:
                for u in await client.users():
                    if (email and u.email.lower() == email) or (
                        username and u.username.lower() == username
                    ):
                        return u.user_id
            except Exception:  # a missing Tautulli must not block the match
                continue
        return None

    def set_tier_override(self, user_id: str, tier: str | None) -> str:
        normalized = Tier.parse(tier).name.lower() if tier else None
        self.store.upsert_user(user_id, tier_override=normalized)
        return f"Tier for {user_id} is now {normalized or 'the default'}."
