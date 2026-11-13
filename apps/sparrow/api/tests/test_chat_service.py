from datetime import timedelta

import pytest

from sparrow.agent.loop import Agent
from sparrow.agent.runner import ToolRunner
from sparrow.agent.tools import Choice, Tier, ToolRegistry, offer
from sparrow.chat.identity import IdentityService
from sparrow.chat.service import UNLINKED_HELP, ChatService, ChatUser, Decision
from sparrow.clients.seerr import SeerrUser
from sparrow.config import Settings
from sparrow.notify import AdminPost
from tests.fake_model import FakeModel, text_message, tool_message

FRIEND = ChatUser("f1", "Friend")
TRUSTED = ChatUser("t1", "Trusty")
ADMIN = ChatUser("a1", "Boss")


def service(registry, services, store, *script) -> ChatService:
    agent = Agent(
        model_client=FakeModel.scripted(*script),
        model="fake",
        runner=ToolRunner(registry),
        store=store,
        services=services,
        settings=Settings(),
    )
    identity = IdentityService(store, services)
    return ChatService(agent=agent, identity=identity, store=store)


@pytest.fixture
def world(services, store):
    """Two stand-in tools: a picker and a destructive call."""
    reg = ToolRegistry()
    calls = []

    @reg.tool("search_media", "search")
    async def search(ctx, query: str = ""):
        return offer([Choice("Dune", "438631", 2021, "A film"), Choice("Dune", "841", 1984)])

    @reg.tool("replace_media", "replace", tier=Tier.TRUSTED, destructive=True)
    async def replace(ctx, file_id: int = 0):
        calls.append(("replace", file_id))
        if file_id < 0:
            raise ConnectionError("arr down")
        return f"replaced file {file_id}"

    for seerr_id, u in enumerate((FRIEND, TRUSTED), 2):
        store.upsert_user(u.id, seerr_user_id=seerr_id)
    store.upsert_user(TRUSTED.id, tier_override="trusted")
    store.upsert_user(ADMIN.id, tier_override="admin")
    services.seerr.user_list = [SeerrUser(4, "new@example.com", "newbie", "")]

    def make(*script):
        return service(reg, services, store, *script)

    return make, store, calls


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
        Choice("Dune", "438631", 2021, "A film"),
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
    assert done.text == "Done: replaced file 7" and calls == [("replace", 7)]
    (notice,) = done.notices
    assert isinstance(notice, AdminPost) and "confirmed: replace_media" in notice.text
    assert await svc.decide(pending.id, TRUSTED, approve=True) == Decision(
        "That action is no longer waiting."
    )

    *_, use, result = store.recent_messages(TRUSTED.id, max_tokens=10_000)
    (use_block,) = use["content"]
    (result_block,) = result["content"]
    assert use["role"] == "assistant" and use_block["type"] == "tool_use"
    assert use_block["name"] == "replace_media" and use_block["input"] == {"file_id": 7}
    assert result["role"] == "user" and result_block["tool_use_id"] == use_block["id"]
    assert result_block["content"] == "replaced file 7"


async def test_a_failed_press_stays_open_to_press_again(world):
    make, store, _ = world
    svc = make(tool_message([("replace_media", {"file_id": -1})]), text_message("Confirm below."))
    (pending,) = (await svc.handle_message(TRUSTED, "replace it")).confirmations
    decision = await svc.decide(pending.id, TRUSTED, approve=True)
    assert not decision.settled and "still open" in decision.text
    assert store.get_pending(pending.id).decision is None


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


async def test_agent_errors_become_a_reference_reply(world):
    make, *_ = world
    svc = make()  # model raises on use
    response = await svc.handle_message(FRIEND, "boom")
    assert response.chunks[0].startswith("Sorry, something went wrong") and "ref" in response.text


async def test_a_turn_that_fails_after_a_tool_acted_keeps_what_it_raised(world):
    make, *_ = world
    svc = make(tool_message([("replace_media", {"file_id": 7})]))  # then the model call fails
    response = await svc.handle_message(TRUSTED, "replace it")
    assert response.chunks[0].startswith("Sorry, something went wrong")
    (pending,) = response.confirmations
    assert pending.action == "replace_media"


async def test_forget(world):
    make, *_ = world
    svc = make(text_message("A"))
    await svc.handle_message(FRIEND, "hello")
    assert svc.forget(FRIEND) == "Forgotten. We're starting fresh."
    assert svc.forget(FRIEND) == "Nothing to forget."


async def test_a_decision_whose_action_is_gone_is_closed_not_reopened(world):
    make, store, _ = world
    pending = store.create_pending(
        action="renamed_since",
        requester=FRIEND.id,
        payload={},
        summary="an old confirmation",
        ttl=timedelta(days=1),
    )
    decision = await make().decide(pending.id, FRIEND, approve=True)
    assert decision.settled and "not available" in decision.text
    assert store.get_pending(pending.id).decision == "approved"
