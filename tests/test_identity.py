from types import SimpleNamespace

import pytest

from maester.agent.tools import Tier
from maester.chat.identity import IdentityService, RoleMap, resolve_tier
from maester.clients import FakeSeerrClient, FakeTautulliClient
from maester.clients.seerr import SeerrUser
from maester.clients.tautulli import TautulliUser
from maester.store import Store, UserRow

ROLES = RoleMap(admin_role_id=1, trusted_role_id=2)


def row(**kw) -> UserRow:
    base = dict(
        discord_id="d",
        plex_email=None,
        plex_username=None,
        seerr_user_id=None,
        tautulli_user_id=None,
        status="active",
        tier_override=None,
    )
    return UserRow(**{**base, **kw})


def test_resolve_tier_rules():
    assert resolve_tier(None, set(), ROLES) == Tier.UNLINKED
    assert resolve_tier(None, {1}, ROLES) == Tier.ADMIN
    assert resolve_tier(row(status="pending"), {2}, ROLES) == Tier.UNLINKED
    assert resolve_tier(row(), set(), ROLES) == Tier.FRIEND
    assert resolve_tier(row(), {2}, ROLES) == Tier.TRUSTED
    assert resolve_tier(row(tier_override="admin"), set(), ROLES) == Tier.ADMIN
    assert resolve_tier(row(tier_override="friend"), {1}, ROLES) == Tier.FRIEND


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


async def test_link_unknown_account_and_empty_query(identity):
    svc, _ = identity
    assert not (await svc.start_link("d1", "x", "nobody@example.com")).ok
    assert "Tell me" in (await svc.start_link("d1", "x", "   ")).message


async def test_approve_and_deny_link(identity):
    svc, store = identity
    pending = (await svc.start_link("d1", "Dany", "dany@example.com")).pending
    assert svc.approve_link(pending.id, "admin").startswith("Linked")
    assert store.get_user("d1").status == "active"
    assert svc.tier_for("d1", {2}) == Tier.TRUSTED
    assert "already linked" in (await svc.start_link("d1", "Dany", "dany@example.com")).message
    assert svc.approve_link(pending.id, "admin") == "That link request is no longer open."

    pending2 = (await svc.start_link("d2", "Jon", "jon")).pending
    assert svc.deny_link(pending2.id, "admin").startswith("Denied")
    assert store.get_user("d2").status == "revoked"
    assert "not linked" in svc.whoami("d2", set())


def test_tier_override(identity):
    svc, store = identity
    store.upsert_user("d1", status="active")
    assert svc.set_tier_override("d1", "TRUSTED").endswith("trusted.")
    assert svc.tier_for("d1", set()) == Tier.TRUSTED
    svc.set_tier_override("d1", None)
    assert svc.tier_for("d1", set()) == Tier.FRIEND
    with pytest.raises(ValueError):
        svc.set_tier_override("d1", "king")
