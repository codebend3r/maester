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
                {"label": "Dune (2021)", "value": "438631"},
                {"label": "Dune (1984)", "value": "841"},
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
    assert response.choices == [Choice("Dune (2021)", "438631"), Choice("Dune (1984)", "841")]


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
    assert "[confirmed #" in store.recent_messages(TRUSTED.id, max_tokens=10_000)[-1]["content"]


async def test_cancel(world):
    make, store, calls, _ = world
    svc = make(tool_message([("replace_media", {"file_id": 7})]), text_message("Confirm below."))
    (pending,) = (await svc.handle_message(TRUSTED, "replace it")).confirmations
    assert await svc.cancel(pending.id, TRUSTED) == "Cancelled."
    assert store.get_pending(pending.id).decision == "denied" and calls == []


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
