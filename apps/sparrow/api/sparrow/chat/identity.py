"""Who a signed-in raven account is on Seerr, and which tier they get.

raven says who someone is: their account (a Supabase user), its email, and
where raven's owner has it (pending, approved or revoked) and whether it is
the owner. sparrow decides what they may do. Tier is resolved on every
request, so a change takes effect immediately: an account raven hasn't
approved (pending or revoked) gets nothing, whatever else is stored; then a
stored override, which the admin sets, wins; then raven's owner is the admin;
then any approved member is a friend. Trusted comes only from the override.

The Seerr match is cached on the user's row and checked again when due:
daily once matched, so someone Seerr no longer lists loses it, and at most
once a minute while unmatched, so someone added to Seerr a minute ago is
matched on their next message. Only the account's email matches, against a
Seerr user's email. A friend without a match still chats; the tools that act
as them in Seerr refuse (`NotLinked`).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sparrow.agent.tools import Tier
from sparrow.clients import ClientError, Services
from sparrow.clients.raven import MemberStatus, RavenAccount
from sparrow.store import Store, UserRow
from sparrow.store.base import stamp

log = logging.getLogger("sparrow.identity")

MATCHED_RECHECK = timedelta(days=1)
UNMATCHED_RECHECK = timedelta(minutes=1)


def resolve_tier(override: str | None, *, owner: bool, approved: bool) -> Tier:
    """Nothing for an account raven hasn't approved (its owner aside); then the stored
    override; then raven's owner is the admin, and an approved member a friend."""
    if not (owner or approved):
        return Tier.UNAPPROVED
    if override:
        return Tier.parse(override)
    return Tier.ADMIN if owner else Tier.FRIEND


def _utcnow() -> datetime:
    return datetime.now(UTC)


class IdentityService:
    def __init__(
        self, store: Store, services: Services, *, clock: Callable[[], datetime] = _utcnow
    ):
        self.store = store
        self.services = services
        self.clock = clock

    def tier_for(self, user_id: str) -> Tier:
        user = self.store.get_user(user_id)
        if user is None:
            return Tier.UNAPPROVED
        return resolve_tier(
            user.tier_override,
            owner=user.is_owner,
            approved=user.raven_status == MemberStatus.APPROVED,
        )

    async def refresh(self, account: RavenAccount) -> UserRow:
        """The user `account` names, upserted from it, with their Seerr match checked when due."""
        now = self.clock()
        user = self.store.upsert_user(
            account.id,
            email=account.email.lower(),
            raven_status=account.status,
            is_owner=int(account.is_owner),
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
        email = user.email or ""
        match = next((u for u in seerr_users if email and u.email == email), None)
        return self.store.upsert_user(
            user.user_id,
            seerr_user_id=match.id if match else None,
            seerr_checked_at=checked,
        )

    def set_tier_override(self, user_id: str, tier: Tier | None) -> str:
        """Give `user_id` the tier `tier` whatever else they are, or their own again (None);
        says what changed."""
        name = tier.name.lower() if tier is not None else None
        self.store.upsert_user(user_id, tier_override=name)
        return f"Tier for {user_id} is now {name or 'the default'}."
