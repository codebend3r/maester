from types import SimpleNamespace

import pytest

from maester.agent.loop import Agent
from maester.agent.runner import ToolRunner
from maester.agent.tools import Tier, ToolRegistry
from maester.chat.identity import IdentityService, RoleMap
from maester.chat.service import UNLINKED_HELP, ChatService, ChatUser, Choice
from maester.clients import FakeSeerrClient
from maester.clients.seerr import SeerrUser
from maester.store import Store
from tests.fake_model import FakeModel, text_message, tool_message

ADMIN_ROLE, TRUSTED_ROLE = 1, 2
FRIEND = ChatUser("f1", "Friend")
TRUSTED = ChatUser("t1", "Trusty", frozenset({TRUSTED_ROLE}))
ADMIN = ChatUser("a1", "Boss", frozenset({ADMIN_ROLE}))


@pytest.fixture
def world():
    reg = ToolRegistry()
    calls = []

    @reg.tool(
        "search_media", "search", {"type": "object", "properties": {"query": {"type": "string"}}}
    )
    async def search(ctx, query=""):
        return {
            "choices": [
                {
                    "label": "Dune",
                    "value": "438631",
                    "year": 2021,
                    "poster_url": "https://image.tmdb.org/t/p/w92/dune.jpg",
                },
                {"label": "Dune", "value": "841", "year": 1984},
            ]
        }

    @reg.tool(
        "replace_media",
        "replace",
        {"type": "object", "properties": {"file_id": {"type": "integer"}}},
        tier=Tier.TRUSTED,
        destructive=True,
    )
    async def replace(ctx, file_id=0):
        calls.append(("replace", file_id))
        return f"replaced file {file_id}"

    store = Store(":memory:")
    for u in (FRIEND, TRUSTED):
        store.upsert_user(u.id, status="active", seerr_user_id=4)
    services = SimpleNamespace(
        seerr=FakeSeerrClient(user_list=[SeerrUser(4, "new@example.com", "newbie", "")]),
        tautulli={},
    )
    notes = []

    async def notify(text, pending):
        notes.append((text, pending))

    def make(*script):
        agent = Agent(
            model_client=FakeModel.scripted(*script),
            model="fake",
            runner=ToolRunner(reg),
            store=store,
            services=services,
        )
        identity = IdentityService(store, services, RoleMap(ADMIN_ROLE, TRUSTED_ROLE))
        return ChatService(agent=agent, identity=identity, store=store, notify_admin=notify)

    yield make, store, calls, notes
    store.close()


async def test_unlinked_user_gets_help_without_calling_the_model(world):
    make, *_ = world
    svc = make()  # no scripted responses: any model call would raise
    response = await svc.handle_message(ChatUser("nobody", "New"), "hi")
    assert response.chunks == [UNLINKED_HELP] and response.tier == Tier.UNLINKED


async def test_message_runs_agent_and_offers_choices(world):
    make, *_ = world
    svc = make(tool_message([("search_media", {"query": "dune"})]), text_message("Which Dune?"))
    response = await svc.handle_message(FRIEND, "get dune")
    assert response.text == "Which Dune?" and response.tier == Tier.FRIEND
    assert response.choices == [
        Choice("Dune", "438631", 2021, "https://image.tmdb.org/t/p/w92/dune.jpg"),
        Choice("Dune", "841", 1984),
    ]
    assert response.choices[0].display == "Dune (2021)"


def test_choice_display_does_not_repeat_the_year():
    assert Choice("Dune (2021)", "438631", 2021).display == "Dune (2021)"
    assert Choice("Dune", "438631").display == "Dune"


async def test_pick_sends_the_choice_back_as_a_message(world):
    make, *_ = world
    svc = make(text_message("Requested Dune (2021)."))
    response = await svc.pick(FRIEND, Choice("Dune (2021)", "438631"))
    assert response.text == "Requested Dune (2021)."
    assert (
        "I pick: Dune (2021) (438631)"
        in svc.agent.client.messages.calls[0]["messages"][-1]["content"]
    )


async def test_confirmation_round_trip(world):
    make, store, calls, notes = world
    svc = make(tool_message([("replace_media", {"file_id": 7})]), text_message("Confirm below."))
    response = await svc.handle_message(TRUSTED, "replace it")
    (pending,) = response.confirmations
    assert pending.action == "replace_media" and calls == []

    assert await svc.confirm(pending.id, FRIEND) == "Only the person who asked can confirm this."
    assert calls == []
    assert (await svc.confirm(pending.id, TRUSTED)) == "Done: replaced file 7"
    assert calls == [("replace", 7)]
    assert notes[-1][0].startswith("Trusty confirmed")
    assert await svc.confirm(pending.id, TRUSTED) == "That action is no longer waiting."

    *_, use, result = store.recent_messages(TRUSTED.id, max_tokens=10_000)
    (use_block,) = use["content"]
    (result_block,) = result["content"]
    assert use["role"] == "assistant" and use_block["type"] == "tool_use"
    assert use_block["name"] == "replace_media" and use_block["input"] == {"file_id": 7}
    assert result["role"] == "user" and result_block["type"] == "tool_result"
    assert result_block["tool_use_id"] == use_block["id"]
    assert result_block["content"] == "replaced file 7"


async def test_confirmed_result_reaches_the_model_on_the_next_turn(world):
    make, *_ = world
    svc = make(
        tool_message([("replace_media", {"file_id": 7})]),
        text_message("Confirm below."),
        text_message("It's replaced."),
    )
    (pending,) = (await svc.handle_message(TRUSTED, "replace it")).confirmations
    await svc.confirm(pending.id, TRUSTED)
    await svc.handle_message(TRUSTED, "did it work?")
    sent = svc.agent.client.messages.calls[-1]["messages"]
    results = [
        b
        for m in sent
        if m["role"] == "user" and isinstance(m["content"], list)
        for b in m["content"]
        if b.get("type") == "tool_result"
    ]
    assert results[-1]["content"] == "replaced file 7"


async def test_cancel(world):
    make, store, calls, _ = world
    svc = make(tool_message([("replace_media", {"file_id": 7})]), text_message("Confirm below."))
    (pending,) = (await svc.handle_message(TRUSTED, "replace it")).confirmations
    assert await svc.cancel(pending.id, TRUSTED) == "Cancelled."
    assert store.get_pending(pending.id).decision == "denied" and calls == []
    last = store.recent_messages(TRUSTED.id, max_tokens=10_000)[-1]
    assert last["content"][0]["content"] == "Cancelled by the user; nothing was done."


async def test_admin_sets_and_clears_a_tier_override(world):
    make, store, *_ = world
    svc = make()
    assert await svc.set_tier(FRIEND, TRUSTED.id, "admin") == "Only the admin can change tiers."
    assert (await svc.set_tier(ADMIN, FRIEND.id, "trusted")).endswith("trusted.")
    assert svc.identity.tier_for(FRIEND.id, set()) == Tier.TRUSTED
    assert (await svc.set_tier(ADMIN, FRIEND.id, None)).endswith("from roles.")
    assert svc.identity.tier_for(FRIEND.id, set()) == Tier.FRIEND
    assert (await svc.set_tier(ADMIN, FRIEND.id, "king")).startswith("Unknown tier")
    rows = store.audit_recent(tool="set_tier")
    assert [r.args for r in rows] == [
        {"target": FRIEND.id, "tier": None},
        {"target": FRIEND.id, "tier": "trusted"},
    ]


async def test_agent_errors_become_a_reference_reply(world):
    make, *_ = world
    svc = make()  # model raises on use
    response = await svc.handle_message(FRIEND, "boom")
    assert (
        response.chunks[0].startswith("Sorry, something went wrong") and "ref" in response.chunks[0]
    )


async def test_link_whoami_forget_and_admin_approval(world):
    make, _, _, notes = world
    svc = make(text_message("A"))
    newbie = ChatUser("n1", "Newbie")
    response = await svc.link(newbie, "new@example.com")
    assert response.approvals and notes[-1][1] is not None
    pending = response.approvals[0]
    assert "waiting for admin" in svc.whoami(newbie)

    assert await svc.approve(pending.id, FRIEND) == "Only the admin can approve this."
    assert (await svc.approve(pending.id, ADMIN)).startswith("Linked")
    assert svc.whoami(newbie).startswith("Linked to new@example.com (active). Tier: friend")

    await svc.handle_message(newbie, "hello")
    assert svc.forget(newbie) == "Forgotten. We're starting fresh."
    assert svc.forget(newbie) == "Nothing to forget."
    assert svc.is_admin(ADMIN) and not svc.is_admin(FRIEND)
