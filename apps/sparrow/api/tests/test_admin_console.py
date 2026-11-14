import pytest

from sparrow.agent.tools import Tier
from sparrow.chat.admin import AdminConsole
from sparrow.chat.identity import IdentityService
from sparrow.chat.service import ChatUser

FRIEND = ChatUser("f1", "Friend")
ADMIN = ChatUser("a1", "Boss")


@pytest.fixture
def console(services, store):
    store.upsert_user(FRIEND.id, seerr_user_id=4, plex_username="dany")
    store.upsert_user(ADMIN.id, tier_override="admin")
    return AdminConsole(identity=IdentityService(store, services), store=store)


def test_admin_sets_and_clears_a_tier_override(console, store):
    identity = console.identity
    assert console.set_tier(FRIEND, ADMIN.id, "admin").text == "Only the admin can use /tier."
    assert console.set_tier(ADMIN, FRIEND.id, "trusted").text.endswith("trusted.")
    assert identity.tier_for(FRIEND.id) == Tier.TRUSTED
    assert console.set_tier(ADMIN, FRIEND.id, None).text.endswith("the default.")
    assert identity.tier_for(FRIEND.id) == Tier.FRIEND
    assert console.set_tier(ADMIN, FRIEND.id, "king").text.startswith("Unknown tier")
    rows = store.audit_recent(tool="/tier")
    assert [(r.args["tier"], r.ok, r.user_id) for r in rows] == [
        ("king", False, ADMIN.id),
        (None, True, ADMIN.id),
        ("trusted", True, ADMIN.id),
        ("admin", False, FRIEND.id),
    ]
