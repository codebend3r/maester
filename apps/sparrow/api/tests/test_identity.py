from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from sparrow.agent.tools import Tier
from sparrow.chat.identity import IdentityService, resolve_tier
from sparrow.clients import FakeSeerrClient
from sparrow.clients.raven import MemberStatus, RavenAccount
from sparrow.clients.seerr import SeerrUser
from sparrow.store import Store

NOW = datetime(2026, 10, 9, 12, 0, tzinfo=UTC)


def account(
    account_id="a-dany", email="dany@example.com", status=MemberStatus.APPROVED, owner=False
):
    return RavenAccount(account_id, email, status, owner)


def test_resolve_tier_rules():
    assert resolve_tier(None, owner=False, approved=False) == Tier.UNAPPROVED
    assert resolve_tier(None, owner=False, approved=True) == Tier.FRIEND
    assert resolve_tier(None, owner=True, approved=True) == Tier.ADMIN
    # The stored override wins over the rest, and is the only way to trusted...
    assert resolve_tier("trusted", owner=False, approved=True) == Tier.TRUSTED
    assert resolve_tier("friend", owner=True, approved=True) == Tier.FRIEND
    # ...but never lets in an account raven hasn't approved.
    assert resolve_tier("admin", owner=False, approved=False) == Tier.UNAPPROVED


@pytest.fixture
def identity():
    store = Store(":memory:")
    services = SimpleNamespace(
        seerr=FakeSeerrClient(
            user_list=[SeerrUser(4, "dany@example.com", "Dany"), SeerrUser(5, "", "jon")]
        )
    )
    clock = SimpleNamespace(now=NOW)
    svc = IdentityService(store, services, clock=lambda: clock.now)
    yield svc, store, clock
    store.close()


async def test_an_email_matching_seerr_links_an_approved_friend(identity):
    svc, store, _ = identity
    user = await svc.refresh(account(email="DANY@example.com"))
    assert (user.email, user.seerr_user_id, user.is_owner) == ("dany@example.com", 4, False)
    assert svc.tier_for("a-dany") == Tier.FRIEND
    assert store.active_link("a-dany").name == "dany@example.com"


async def test_an_approved_member_seerr_doesn_t_know_is_a_friend_without_a_link(identity):
    svc, store, _ = identity
    await svc.refresh(account("a-x", "x@example.com"))
    assert svc.tier_for("a-x") == Tier.FRIEND and store.active_link("a-x") is None


async def test_pending_revoked_and_unseen_accounts_get_no_tier(identity):
    svc, _, _ = identity
    await svc.refresh(account("a-new", "new@example.com", MemberStatus.PENDING))
    await svc.refresh(account(status=MemberStatus.REVOKED))
    assert svc.tier_for("a-new") == Tier.UNAPPROVED
    assert svc.tier_for("a-dany") == Tier.UNAPPROVED
    assert svc.tier_for("never-seen") == Tier.UNAPPROVED


async def test_raven_s_owner_is_admin_and_loses_it_when_ownership_moves(identity):
    svc, _, _ = identity
    await svc.refresh(account("a-boss", "boss@example.com", owner=True))
    assert svc.tier_for("a-boss") == Tier.ADMIN
    await svc.refresh(account("a-boss", "boss@example.com"))
    assert svc.tier_for("a-boss") == Tier.FRIEND


async def test_an_unmatched_user_is_checked_again_after_a_minute(identity):
    svc, _, clock = identity
    newbie = account("a-new", "new@example.com")
    assert (await svc.refresh(newbie)).seerr_user_id is None
    svc.services.seerr.user_list.append(SeerrUser(7, "new@example.com", "Newbie"))
    clock.now += timedelta(seconds=59)
    assert (await svc.refresh(newbie)).seerr_user_id is None  # not due yet
    clock.now += timedelta(seconds=1)
    assert (await svc.refresh(newbie)).seerr_user_id == 7


async def test_a_matched_user_is_checked_daily_and_loses_the_link_when_seerr_drops_them(
    identity,
):
    svc, store, clock = identity
    await svc.refresh(account())
    svc.services.seerr.user_list = []
    clock.now += timedelta(hours=23)
    assert (await svc.refresh(account())).seerr_user_id == 4
    clock.now += timedelta(hours=1)
    assert (await svc.refresh(account())).seerr_user_id is None
    assert store.active_link("a-dany") is None


async def test_seerr_down_keeps_the_match_and_waits_for_the_next_check(identity):
    svc, _, clock = identity
    await svc.refresh(account())
    svc.services.seerr.down = True
    clock.now += timedelta(days=1)
    user = await svc.refresh(account())
    assert user.seerr_user_id == 4 and user.seerr_checked_at == "2026-10-10T12:00:00.000Z"


async def test_each_refresh_takes_the_account_s_latest_details(identity):
    svc, _, clock = identity
    await svc.refresh(account())
    clock.now += timedelta(minutes=5)
    user = await svc.refresh(account(email="dany@new.example.com"))
    assert user.email == "dany@new.example.com" and user.seerr_user_id == 4
    assert user.last_seen_at == "2026-10-09T12:05:00.000Z"


def test_tier_override(identity):
    svc, store, _ = identity
    store.upsert_user("d1", seerr_user_id=4, raven_status="approved")
    assert svc.set_tier_override("d1", Tier.TRUSTED).endswith("trusted.")
    assert svc.tier_for("d1") == Tier.TRUSTED
    assert svc.set_tier_override("d1", None).endswith("the default.")
    assert svc.tier_for("d1") == Tier.FRIEND
