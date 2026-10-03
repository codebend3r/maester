from types import SimpleNamespace

import pytest

from luwin.agent.tools import Tier
from luwin.chat.identity import IdentityService, RoleMap, resolve_tier
from luwin.clients import FakeSeerrClient, FakeTautulliClient
from luwin.clients.seerr import SeerrUser
from luwin.clients.tautulli import TautulliUser
from luwin.store import Store

ROLES = RoleMap(admin_role_id=1, trusted_role_id=2)


def test_resolve_tier_rules():
    assert resolve_tier(None, False, set(), ROLES) == Tier.UNLINKED
    assert resolve_tier(None, False, {1}, ROLES) == Tier.ADMIN
    assert resolve_tier(None, False, {2}, ROLES) == Tier.UNLINKED
    assert resolve_tier(None, True, set(), ROLES) == Tier.FRIEND
    assert resolve_tier(None, True, {2}, ROLES) == Tier.TRUSTED
    assert resolve_tier("admin", False, set(), ROLES) == Tier.ADMIN
    assert resolve_tier("friend", True, {1}, ROLES) == Tier.FRIEND


@pytest.fixture
def identity():
    store = Store(":memory:")
    services = SimpleNamespace(
        seerr=FakeSeerrClient(
            user_list=[
                SeerrUser(4, "dany@example.com", "Dany", "dany_t"),
                SeerrUser(5, "", "jon", ""),
            ]
        ),
        tautulli={
            "meleys": FakeTautulliClient(
                user_list=[TautulliUser(8008135, "dany_t", "Dany", "dany@example.com")]
            )
        },
    )
    svc = IdentityService(store, services, ROLES)
    yield svc, store
    store.close()


async def test_link_matches_email_or_username_and_queues_approval(identity):
    svc, store = identity
    result = await svc.start_link("d1", "Dany#1", "DANY@example.com")
    assert result.ok and result.pending and result.pending.action == "link_account"
    user = store.get_user("d1")
    assert user.seerr_user_id == 4 and user.tautulli_user_id == 8008135 and user.status == "pending"
    assert svc.tier_for("d1", set()) == Tier.UNLINKED
    assert "waiting for admin" in svc.whoami("d1", set())

    again = await svc.start_link("d1", "Dany#1", "dany@example.com")
    assert not again.ok and "already waiting" in again.message

    result2 = await svc.start_link("d2", "Jon", "jon")
    assert result2.ok and store.get_user("d2").seerr_user_id == 5


async def test_link_matches_a_mixed_case_seerr_email(identity):
    svc, store = identity
    svc.services.seerr.user_list.append(SeerrUser(6, "Arya@Example.com", "arya", ""))
    result = await svc.start_link("d3", "Arya", "arya@example.com")
    assert result.ok and store.get_user("d3").seerr_user_id == 6


async def test_link_unknown_account_and_empty_query(identity):
    svc, _ = identity
    assert not (await svc.start_link("d1", "x", "nobody@example.com")).ok
    assert "Tell me" in (await svc.start_link("d1", "x", "   ")).message


def test_tier_override(identity):
    svc, store = identity
    store.upsert_user("d1", status="active", seerr_user_id=4)
    assert svc.set_tier_override("d1", "TRUSTED").endswith("trusted.")
    assert svc.tier_for("d1", set()) == Tier.TRUSTED
    svc.set_tier_override("d1", None)
    assert svc.tier_for("d1", set()) == Tier.FRIEND
    with pytest.raises(ValueError):
        svc.set_tier_override("d1", "king")


async def test_a_plex_account_links_to_one_discord_account(identity):
    svc, store = identity
    assert (await svc.start_link("d1", "Dany", "dany@example.com")).ok
    taken = await svc.start_link("d9", "Imposter", "dany_t")
    assert not taken.ok and "already linked to another Discord account" in taken.message
    assert store.get_user("d9") is None
    store.upsert_user("d1", status="revoked")
    assert (await svc.start_link("d9", "Dany again", "dany_t")).ok


async def test_a_link_racing_another_for_the_same_account_loses_kindly(identity):
    svc, store = identity

    async def meanwhile(email, username):
        # Another /link for the same Plex account lands while Tautulli is asked.
        store.upsert_user("d9", seerr_user_id=4, status="pending")
        return None

    svc._tautulli_id = meanwhile
    result = await svc.start_link("d1", "Dany", "dany@example.com")
    assert not result.ok and "already linked to another Discord account" in result.message
    assert store.open_pending() == []
