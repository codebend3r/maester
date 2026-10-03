from types import SimpleNamespace

from maester.agent.tools import Tier, ToolContext, registry, validate_input
from maester.chat.identity import IdentityService, RoleMap
from maester.clients import FakeSeerrClient
from maester.clients.seerr import SeerrUser
from maester.config import Settings
from maester.memo import Memo
from maester.notify import DirectMessage
from maester.tools.accounts import link_account


async def test_a_link_request_is_decided_by_the_link_account_tool(store):
    services = SimpleNamespace(
        seerr=FakeSeerrClient(user_list=[SeerrUser(4, "dany@example.com", "Dany", "dany_t")]),
        tautulli={},
    )
    identity = IdentityService(store, services, RoleMap(1, 2))
    pending = (await identity.start_link("d1", "Dany", "dany@example.com")).pending
    spec = registry.get(pending.action)
    assert spec.button_only and spec.tier == Tier.ADMIN
    validate_input(spec.input_schema, {**pending.payload, "approved": True})

    admin = ToolContext("boss", Tier.ADMIN, services, store, Settings(), Memo())
    linked = await link_account(admin, approved=True, **pending.payload)
    assert linked.content == "Linked Dany to dany@example.com."
    (dm,) = linked.notices
    assert isinstance(dm, DirectMessage) and dm.to == "d1" and "linked" in dm.text
    assert store.active_link("d1").seerr_user_id == 4
    assert identity.tier_for("d1", {2}) == Tier.TRUSTED
    assert "already linked" in (await identity.start_link("d1", "Dany", "dany")).message

    denied = await link_account(admin, approved=False, **pending.payload)
    assert denied.content.startswith("Denied") and denied.notices[0].to == "d1"
    assert store.get_user("d1").status == "revoked" and store.active_link("d1") is None
