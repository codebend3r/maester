from datetime import timedelta

import pytest

from maester.agent.loop import Agent
from maester.agent.runner import ToolRunner
from maester.agent.tools import Choice, Choices, Tier, ToolRegistry
from maester.agent.tools import registry as app_registry
from maester.chat.identity import IdentityService, RoleMap
from maester.chat.service import UNLINKED_HELP, ChatService, ChatUser, Decision
from maester.clients.seerr import (
    ArrServer,
    MediaDetails,
    MediaStatus,
    RequestStatus,
    SeerrUser,
    ServerOptions,
)
from maester.config import Settings
from maester.notify import AdminPost, ApprovalPost, DirectMessage
from tests.fake_model import FakeModel, text_message, tool_message

# Importing the tools package registers the real tools into `app_registry`.
import maester.tools  # noqa: F401  isort: skip

ADMIN_ROLE, TRUSTED_ROLE = 1, 2
FRIEND = ChatUser("f1", "Friend")
TRUSTED = ChatUser("t1", "Trusty", frozenset({TRUSTED_ROLE}))
ADMIN = ChatUser("a1", "Boss", frozenset({ADMIN_ROLE}))


def service(registry, services, store, *script) -> ChatService:
    agent = Agent(
        model_client=FakeModel.scripted(*script),
        model="fake",
        runner=ToolRunner(registry),
        store=store,
        services=services,
        settings=Settings(),
    )
    identity = IdentityService(store, services, RoleMap(ADMIN_ROLE, TRUSTED_ROLE))
    return ChatService(agent=agent, identity=identity, store=store)


@pytest.fixture
def world(services, store):
    """Two stand-in tools (a picker, a destructive call) plus the real link decision."""
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

    reg.register(app_registry.get("link_account"))
    for seerr_id, u in enumerate((FRIEND, TRUSTED), 2):
        store.upsert_user(u.id, status="active", seerr_user_id=seerr_id)
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
    assert response.chunks[0].startswith("Sorry, something went wrong") and "ref" in response.text


async def test_a_turn_that_fails_after_a_tool_acted_keeps_what_it_raised(world):
    make, *_ = world
    svc = make(tool_message([("replace_media", {"file_id": 7})]))  # then the model call fails
    response = await svc.handle_message(TRUSTED, "replace it")
    assert response.chunks[0].startswith("Sorry, something went wrong")
    (pending,) = response.confirmations
    assert pending.action == "replace_media"


async def test_link_whoami_forget_and_admin_approval(world):
    make, *_ = world
    svc = make(text_message("A"))
    newbie = ChatUser("n1", "Newbie")
    response = await svc.link(newbie, "new@example.com")
    (notice,) = response.notices
    assert isinstance(notice, ApprovalPost) and notice.text.startswith("Link request")
    assert "waiting for admin" in svc.whoami(newbie)

    assert await svc.decide(notice.pending_id, FRIEND, approve=True) == Decision(
        "Only the admin can approve this.", settled=False
    )
    approved = await svc.decide(notice.pending_id, ADMIN, approve=True)
    assert approved.text == "Linked Newbie to new@example.com."
    (dm,) = approved.notices
    assert isinstance(dm, DirectMessage) and dm.to == "n1"
    assert svc.whoami(newbie).startswith("Linked to new@example.com (active). Tier: friend")

    await svc.handle_message(newbie, "hello")
    assert svc.forget(newbie) == "Forgotten. We're starting fresh."
    assert svc.forget(newbie) == "Nothing to forget."
    assert svc.is_admin(ADMIN) and not svc.is_admin(FRIEND)


async def test_admin_denies_a_link(world):
    make, store, _ = world
    svc = make()
    (notice,) = (await svc.link(ChatUser("n1", "Newbie"), "new@example.com")).notices
    assert (await svc.decide(notice.pending_id, ADMIN, approve=False)).text.startswith("Denied")
    assert store.get_user("n1").status == "revoked"
    assert await svc.decide(notice.pending_id, ADMIN, approve=True) == Decision(
        "That request is no longer open."
    )


async def test_a_decision_whose_action_is_gone_is_closed_not_reopened(world):
    make, store, _ = world
    pending = store.create_pending(
        kind="approve",
        action="renamed_since",
        requester=FRIEND.id,
        payload={},
        summary="an old approval",
        ttl=timedelta(days=1),
    )
    decision = await make().decide(pending.id, ADMIN, approve=True)
    assert decision.settled and "no longer exists" in decision.text
    assert store.get_pending(pending.id).decision == "approved"


DUNE = MediaDetails(438631, "movie", "Dune", 2021, "", MediaStatus.AVAILABLE, MediaStatus.UNKNOWN)


async def test_a_trusted_4k_request_is_approved_by_the_admin_end_to_end(services, store):
    """The real tools: a trusted friend asks for 4K, the admin approves, Seerr and the friend hear."""
    store.upsert_user(TRUSTED.id, status="active", seerr_user_id=7, plex_username="trusty")
    seerr = services.seerr
    seerr.details[("movie", 438631)] = DUNE
    seerr.server_list["radarr"] = [ServerOptions(ArrServer(1, "Radarr 4K", True, True), (), ())]
    svc = service(
        app_registry,
        services,
        store,
        tool_message([("request_media_4k", {"tmdb_id": 438631, "media_type": "movie"})]),
        text_message("I've asked the admin."),
    )
    response = await svc.handle_message(TRUSTED, "Dune in 4K please")
    assert response.text == "I've asked the admin."
    (post,) = response.notices
    assert isinstance(post, ApprovalPost) and post.text.startswith("trusty asks for Dune (2021)")
    (request,) = seerr.requests
    assert request.is_4k and request.requested_by_id == 7

    seerr.down = True  # the first press fails in Seerr and stays open
    failed = await svc.decide(post.pending_id, ADMIN, approve=True)
    assert not failed.settled and "still open" in failed.text
    seerr.down = False
    approved = await svc.decide(post.pending_id, ADMIN, approve=True)
    assert approved.text == "Approved Dune (2021) in 4K in Seerr (request #1)."
    (dm,) = approved.notices
    assert dm.to == TRUSTED.id and "approved Dune (2021) in 4K" in dm.text
    assert seerr.requests[0].status == RequestStatus.APPROVED
