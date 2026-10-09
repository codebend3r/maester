from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from luwin.agent.tools import Tier
from luwin.chat.identity import IdentityService, resolve_tier
from luwin.clients import Account, FakePlexTv, FakeSeerrClient, FakeTautulliClient, PlexAccount
from luwin.clients.seerr import SeerrUser
from luwin.clients.tautulli import TautulliUser
from luwin.store import Store

NOW = datetime(2026, 10, 9, 12, 0, tzinfo=UTC)


def account(user_id="r-dany", plex_id="44", email="dany@example.com", username="dany_t"):
    return Account(
        user_id=user_id,
        display_name=username,
        email=email,
        thumb="https://plex.tv/users/44/avatar",
        plex_id=plex_id,
        plex_username=username,
        plex_email=email,
        expires_at=NOW + timedelta(days=30),
    )


def test_resolve_tier_rules():
    assert resolve_tier(None, owner=False, linked=False) == Tier.UNLINKED
    assert resolve_tier(None, owner=False, linked=True) == Tier.FRIEND
    # The server's owner is the admin, linked to Seerr or not.
    assert resolve_tier(None, owner=True, linked=False) == Tier.ADMIN
    # The stored override wins over everything, and is the only way to trusted.
    assert resolve_tier("trusted", owner=False, linked=True) == Tier.TRUSTED
    assert resolve_tier("friend", owner=True, linked=True) == Tier.FRIEND
    assert resolve_tier("admin", owner=False, linked=False) == Tier.ADMIN


@pytest.fixture
def identity():
    store = Store(":memory:")
    services = SimpleNamespace(
        seerr=FakeSeerrClient(
            user_list=[
                SeerrUser(4, "dany@example.com", "Dany", "dany_t"),
                SeerrUser(5, "", "jon", ""),
                SeerrUser(6, "", "Arya", "arya_s"),
            ]
        ),
        tautulli={
            "meleys": FakeTautulliClient(
                user_list=[TautulliUser(8008135, "dany_t", "Dany", "dany@example.com")]
            )
        },
        plextv=FakePlexTv(owner=PlexAccount("1", "boss", "boss@example.com")),
    )
    clock = SimpleNamespace(now=NOW)
    svc = IdentityService(store, services, clock=lambda: clock.now)
    yield svc, store, clock
    store.close()


async def test_a_plex_email_matching_seerr_makes_a_friend_with_their_tautulli_id(identity):
    svc, store, _ = identity
    user = await svc.refresh(account(email="DANY@example.com", username="someone_else"))
    assert user.seerr_user_id == 4 and user.tautulli_user_id == 8008135
    assert (user.plex_id, user.plex_email, user.thumb) == (
        "44",
        "DANY@example.com",
        "https://plex.tv/users/44/avatar",
    )
    assert svc.tier_for("r-dany") == Tier.FRIEND
    assert store.active_link("r-dany").name == "someone_else"


async def test_a_plex_username_matches_only_seerr_s_plex_username(identity):
    svc, _, _ = identity
    arya = await svc.refresh(account("r-arya", "45", email="", username="ARYA_S"))
    assert arya.seerr_user_id == 6
    # "jon" is a local Seerr user's display name, which anyone could pick: no match.
    jon = await svc.refresh(account("r-jon", "46", email="jon@elsewhere.com", username="jon"))
    assert jon.seerr_user_id is None and svc.tier_for("r-jon") == Tier.UNLINKED


async def test_a_stranger_is_unlinked_and_someone_never_seen_is_too(identity):
    svc, _, _ = identity
    await svc.refresh(account("r-x", "99", email="x@example.com", username="x"))
    assert svc.tier_for("r-x") == Tier.UNLINKED
    assert svc.tier_for("never-seen") == Tier.UNLINKED


async def test_the_owner_is_admin_once_plex_tv_has_said_who_it_is(identity):
    svc, _, clock = identity
    plextv = svc.services.plextv
    plextv.down = True
    await svc.refresh(account("r-boss", "1", email="boss@example.com", username="boss"))
    assert await svc.load_owner() is None
    assert svc.tier_for("r-boss") == Tier.UNLINKED  # unknown owner, and no Seerr user
    plextv.down = False
    assert await svc.load_owner() is None  # asked a moment ago: not again yet
    clock.now += timedelta(minutes=1)
    assert (await svc.load_owner()).username == "boss"
    assert svc.tier_for("r-boss") == Tier.ADMIN
    plextv.down = True
    assert (await svc.load_owner()).id == "1"  # known now: never asked again


async def test_without_plex_tv_there_is_no_owner(identity):
    svc, _, _ = identity
    svc.services.plextv = None
    assert await svc.load_owner() is None


async def test_an_unmatched_user_is_checked_again_after_a_minute(identity):
    svc, _, clock = identity
    newbie = account("r-new", "50", email="new@example.com", username="newbie")
    assert (await svc.refresh(newbie)).seerr_user_id is None
    svc.services.seerr.user_list.append(SeerrUser(7, "new@example.com", "Newbie", "newbie"))
    clock.now += timedelta(seconds=59)
    assert (await svc.refresh(newbie)).seerr_user_id is None  # not due yet
    clock.now += timedelta(seconds=1)
    assert (await svc.refresh(newbie)).seerr_user_id == 7
    assert svc.tier_for("r-new") == Tier.FRIEND


async def test_a_matched_user_is_checked_daily_and_loses_access_when_seerr_drops_them(identity):
    svc, _, clock = identity
    await svc.refresh(account())
    svc.services.seerr.user_list = []
    clock.now += timedelta(hours=23)
    assert (await svc.refresh(account())).seerr_user_id == 4
    clock.now += timedelta(hours=1)
    user = await svc.refresh(account())
    assert user.seerr_user_id is None and user.tautulli_user_id is None
    assert svc.tier_for("r-dany") == Tier.UNLINKED


async def test_seerr_down_keeps_the_match_and_waits_for_the_next_check(identity):
    svc, _, clock = identity
    await svc.refresh(account())
    svc.services.seerr.down = True
    clock.now += timedelta(days=1)
    user = await svc.refresh(account())
    assert user.seerr_user_id == 4 and user.seerr_checked_at == "2026-10-10T12:00:00.000Z"


async def test_each_refresh_takes_the_account_s_latest_plex_details(identity):
    svc, _, clock = identity
    await svc.refresh(account())
    clock.now += timedelta(minutes=5)
    renamed = account(username="dany_targaryen")
    user = await svc.refresh(renamed)
    assert user.plex_username == "dany_targaryen" and user.seerr_user_id == 4
    assert user.last_seen_at == "2026-10-09T12:05:00.000Z"


def test_tier_override(identity):
    svc, store, _ = identity
    store.upsert_user("d1", seerr_user_id=4)
    assert svc.set_tier_override("d1", "TRUSTED").endswith("trusted.")
    assert svc.tier_for("d1") == Tier.TRUSTED
    svc.set_tier_override("d1", None)
    assert svc.tier_for("d1") == Tier.FRIEND
    with pytest.raises(ValueError):
        svc.set_tier_override("d1", "king")
