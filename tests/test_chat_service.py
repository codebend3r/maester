from types import SimpleNamespace

import pytest

from maester.agent.loop import Agent
from maester.agent.runner import ToolRunner
from maester.agent.tools import Approval, Choice, Choices, ForAdmin, Settled, Tier, ToolRegistry
from maester.chat.identity import IdentityService, RoleMap
from maester.chat.service import UNLINKED_HELP, ChatService, ChatUser, Decision
from maester.clients import FakeSeerrClient
from maester.clients.seerr import SeerrUser
from maester.config import Settings
from maester.notify import AdminPost, DirectMessage
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
        return Choices(
            [
                Choice("Dune", "438631", 2021, "https://image.tmdb.org/t/p/w92/dune.jpg"),
                Choice("Dune", "841", 1984),
            ]
        )

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

    async def settle_4k(ctx, pending, approved):
        if calls and calls[-1] == "seerr down":
            calls.pop()
            raise ConnectionError("seerr down")
        calls.append(("settle", ctx.user_id, pending.payload["request_id"], approved))
        return Settled("settled", (DirectMessage(pending.requester, "your 4K was decided"),))

    @reg.tool(
        "request_4k",
        "4K",
        {"type": "object", "properties": {"tmdb_id": {"type": "integer"}}},
        tier=Tier.TRUSTED,
        settle=settle_4k,
    )
    async def request_4k(ctx, tmdb_id=0):
        return ForAdmin(
            {"request_id": 12},
            "Trusty wants Dune in 4K",
            Approval("4K Dune for Trusty", {"request_id": 12}),
        )

    store = Store(":memory:")
    for seerr_id, u in enumerate((FRIEND, TRUSTED), 2):
        store.upsert_user(u.id, status="active", seerr_user_id=seerr_id)
    services = SimpleNamespace(
        seerr=FakeSeerrClient(user_list=[SeerrUser(4, "new@example.com", "newbie", "")]),
        tautulli={},
    )

    def make(*script):
        agent = Agent(
            model_client=FakeModel.scripted(*script),
            model="fake",
            runner=ToolRunner(reg),
            store=store,
            services=services,
            settings=Settings(),
        )
        identity = IdentityService(store, services, RoleMap(ADMIN_ROLE, TRUSTED_ROLE))
        return ChatService(agent=agent, identity=identity, store=store)

    yield make, store, calls
    store.close()


async def test_unlinked_user_gets_help_without_calling_the_model(world):
    make, *_ = world
    svc = make()  # no scripted responses: any model call would raise
    response = await svc.handle_message(ChatUser("nobody", "New"), "hi")
    assert response.chunks == [UNLINKED_HELP]


async def test_message_runs_agent_and_offers_choices(world):
    make, *_ = world
    svc = make(tool_message([("search_media", {"query": "dune"})]), text_message("Which Dune?"))
    response = await svc.handle_message(FRIEND, "get dune")
    assert response.text == "Which Dune?"
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
    make, store, calls = world
    svc = make(tool_message([("replace_media", {"file_id": 7})]), text_message("Confirm below."))
    response = await svc.handle_message(TRUSTED, "replace it")
    (pending,) = response.confirmations
    assert pending.action == "replace_media" and calls == []

    done = await svc.decide(pending.id, TRUSTED, approve=True)
    assert done == Decision("Done: replaced file 7", notices=done.notices)
    assert calls == [("replace", 7)]
    (notice,) = done.notices
    assert notice == AdminPost(notice.text) and notice.text.startswith("Trusty confirmed")
    assert await svc.decide(pending.id, TRUSTED, approve=True) == Decision(
        "That action is no longer waiting."
    )

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
    await svc.decide(pending.id, TRUSTED, approve=True)
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


async def test_someone_else_cannot_confirm_or_cancel(world):
    make, store, calls = world
    svc = make(tool_message([("replace_media", {"file_id": 7})]), text_message("Confirm below."))
    (pending,) = (await svc.handle_message(TRUSTED, "replace it")).confirmations
    assert await svc.decide(pending.id, FRIEND, approve=True) == Decision(
        "Only the person who asked can confirm this.", settled=False
    )
    assert await svc.decide(pending.id, FRIEND, approve=False) == Decision(
        "Only the person who asked can cancel this.", settled=False
    )
    assert calls == [] and store.get_pending(pending.id).decision is None


async def test_unknown_pending_action(world):
    make, *_ = world
    assert (await make().decide(999, TRUSTED, approve=True)).text == "That's no longer waiting."


async def test_cancel(world):
    make, store, calls = world
    svc = make(tool_message([("replace_media", {"file_id": 7})]), text_message("Confirm below."))
    (pending,) = (await svc.handle_message(TRUSTED, "replace it")).confirmations
    assert await svc.decide(pending.id, TRUSTED, approve=False) == Decision("Cancelled.")
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
    make, store, _ = world
    svc = make(text_message("A"))
    newbie = ChatUser("n1", "Newbie")
    response = await svc.link(newbie, "new@example.com")
    (notice,) = response.notices
    pending = store.get_pending(notice.pending_id)
    assert notice.text.startswith("Link request") and pending.action == "link_account"
    assert "waiting for admin" in svc.whoami(newbie)

    assert await svc.decide(pending.id, FRIEND, approve=True) == Decision(
        "Only the admin can approve this.", settled=False
    )
    approved = await svc.decide(pending.id, ADMIN, approve=True)
    assert approved.text.startswith("Linked") and approved.notices[0].to == "n1"
    assert svc.whoami(newbie).startswith("Linked to new@example.com (active). Tier: friend")

    await svc.handle_message(newbie, "hello")
    assert svc.forget(newbie) == "Forgotten. We're starting fresh."
    assert svc.forget(newbie) == "Nothing to forget."
    assert svc.is_admin(ADMIN) and not svc.is_admin(FRIEND)


async def test_admin_denies_a_link(world):
    make, store, _ = world
    svc = make()
    pending = store.get_pending(
        (await svc.link(ChatUser("n1", "Newbie"), "new@example.com")).notices[0].pending_id
    )
    assert (await svc.decide(pending.id, ADMIN, approve=False)).text.startswith("Denied")
    assert store.get_user("n1").status == "revoked"
    assert await svc.decide(pending.id, ADMIN, approve=True) == Decision(
        "That request is no longer open."
    )


async def test_a_failed_link_approval_is_reopened_for_another_press(world, monkeypatch):
    make, store, _ = world
    svc = make()
    pending = store.get_pending(
        (await svc.link(ChatUser("n1", "Newbie"), "new@example.com")).notices[0].pending_id
    )

    def broken(*args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(store, "upsert_user", broken)
    decision = await svc.decide(pending.id, ADMIN, approve=True)
    monkeypatch.undo()
    assert not decision.settled and "still open" in decision.text
    assert store.get_pending(pending.id).decision is None
    assert store.get_user("n1").status == "pending"
    assert (await svc.decide(pending.id, ADMIN, approve=True)).text.startswith("Linked")


async def test_an_approval_a_tool_raises_reaches_the_admin_and_its_settle_runs(world):
    make, store, calls = world
    svc = make(tool_message([("request_4k", {"tmdb_id": 1})]), text_message("Sent to the admin."))
    response = await svc.handle_message(TRUSTED, "dune in 4k")
    assert response.text == "Sent to the admin." and response.confirmations == []
    (notice,) = response.notices
    pending = store.get_pending(notice.pending_id)
    assert notice.text == "Trusty wants Dune in 4K" and pending.requester == TRUSTED.id

    assert (await svc.decide(pending.id, TRUSTED, approve=True)).settled is False
    decision = await svc.decide(pending.id, ADMIN, approve=True)
    assert decision == Decision("settled", notices=(DirectMessage("t1", "your 4K was decided"),))
    assert calls == [("settle", ADMIN.id, 12, True)]
    assert store.audit_recent(1)[0].tool == "request_4k"
    assert (await svc.decide(pending.id, ADMIN, approve=False)).text.startswith("That request")


async def test_a_failed_settle_leaves_the_approval_open(world):
    make, store, calls = world
    svc = make(tool_message([("request_4k", {"tmdb_id": 1})]), text_message("Sent."))
    pending = store.get_pending(
        (await svc.handle_message(TRUSTED, "dune in 4k")).notices[0].pending_id
    )
    calls.append("seerr down")
    decision = await svc.decide(pending.id, ADMIN, approve=False)
    assert not decision.settled and "still open" in decision.text
    assert store.get_pending(pending.id).decision is None
    assert (await svc.decide(pending.id, ADMIN, approve=False)).text == "settled"
    assert calls == [("settle", ADMIN.id, 12, False)]


async def test_a_turn_that_fails_after_a_tool_acted_still_reaches_the_admin(world):
    make, store, _ = world
    svc = make(tool_message([("request_4k", {"tmdb_id": 1})]))  # then the model call fails
    response = await svc.handle_message(TRUSTED, "dune in 4k")
    assert response.chunks[0].startswith("Sorry, something went wrong")
    (notice,) = response.notices
    assert store.get_pending(notice.pending_id).action == "request_4k"
