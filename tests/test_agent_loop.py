from datetime import UTC, datetime, timedelta

import pytest

from maester.agent.limits import RateLimiter
from maester.agent.loop import MAX_TOOL_ITERATIONS, Agent, AgentReply
from maester.agent.runner import ToolRunner
from maester.agent.tools import Tier, ToolRegistry
from maester.store import Store
from tests.fake_model import FakeModel, text_message, tool_message

SEARCH_SCHEMA = {
    "type": "object",
    "properties": {"query": {"type": "string"}},
    "required": ["query"],
}


@pytest.fixture
def world():
    reg = ToolRegistry()

    @reg.tool("search_media", "search", SEARCH_SCHEMA)
    async def search(ctx, query):
        return [{"title": "Dune", "year": 2021}, {"title": "Dune", "year": 1984}]

    @reg.tool("replace_media", "replace", SEARCH_SCHEMA, tier=Tier.TRUSTED, destructive=True)
    async def replace(ctx, query):
        return "replaced " * 200

    store = Store(":memory:")

    def make(*script, limiter=None, now=None):
        model = FakeModel.scripted(*script)
        agent = Agent(
            model_client=model,
            model="fake",
            runner=ToolRunner(reg),
            store=store,
            services=None,
            limiter=limiter,
            now=now or (lambda: datetime.now(UTC)),
        )
        return agent, model

    yield make, store
    store.close()


async def test_plain_reply_streams_text_and_is_remembered(world):
    make, store = world
    agent, model = make(text_message("Hello there."))
    chunks = []
    reply = await agent.respond("u1", Tier.FRIEND, "hi", on_text=chunks.append)
    assert reply.text == "Hello there." and chunks == ["Hello there."]
    assert reply.iterations == 1 and reply.tool_calls == []
    params = model.messages.calls[0]
    assert params["model"] == "fake"
    assert params["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert [t["name"] for t in params["tools"]] == ["search_media"]
    assert params["messages"] == [{"role": "user", "content": "hi"}]
    history = store.recent_messages("u1", max_tokens=1000)
    assert [m["role"] for m in history] == ["user", "assistant"]


async def test_tool_call_round_trip(world):
    make, store = world
    agent, model = make(
        tool_message([("search_media", {"query": "dune"})], text="Let me look."),
        text_message("There are two: 2021 and 1984. Which one?"),
    )
    reply = await agent.respond("u1", Tier.FRIEND, "get dune")
    assert reply.text.startswith("There are two")
    assert reply.tool_calls == [{"name": "search_media", "input": {"query": "dune"}, "ok": True}]
    second = model.messages.calls[1]["messages"]
    assert second[-2]["role"] == "assistant" and second[-2]["content"][-1]["type"] == "tool_use"
    assert second[-1]["role"] == "user" and second[-1]["content"][0]["type"] == "tool_result"
    assert "1984" in second[-1]["content"][0]["content"]
    assert store.audit_recent(1)[0].tool == "search_media"


async def test_history_is_replayed_but_idle_history_is_not(world):
    make, _ = world
    agent, model = make(text_message("A"), text_message("B"))
    await agent.respond("u1", Tier.FRIEND, "one")
    await agent.respond("u1", Tier.FRIEND, "two")
    assert [m["content"] for m in model.messages.calls[1]["messages"]][:3] == [
        "one",
        [{"type": "text", "text": "A"}],
        "two",
    ]

    later = lambda: datetime.now(UTC) + timedelta(hours=7)  # noqa: E731
    agent2, model2 = make(text_message("C"), now=later)
    await agent2.respond("u1", Tier.FRIEND, "three")
    assert model2.messages.calls[0]["messages"] == [{"role": "user", "content": "three"}]


async def test_forget_clears_memory(world):
    make, store = world
    agent, _ = make(text_message("A"))
    await agent.respond("u1", Tier.FRIEND, "one")
    assert agent.forget("u1") == 2
    assert store.recent_messages("u1", max_tokens=1000) == []


async def test_destructive_call_surfaces_pending_id_and_model_is_told_to_stop(world):
    make, store = world
    agent, model = make(
        tool_message([("replace_media", {"query": "dune"})]),
        text_message("Confirm below and I'll replace it."),
    )
    reply = await agent.respond("u1", Tier.TRUSTED, "replace dune")
    assert len(reply.pending_ids) == 1
    result = model.messages.calls[1]["messages"][-1]["content"][0]["content"]
    assert "awaiting_confirmation" in result
    assert store.open_pending("confirm")[0].action == "replace_media"


async def test_resolve_confirmation_runs_the_tool_and_remembers_it_like_any_call(world):
    make, store = world
    agent, _ = make(
        tool_message([("replace_media", {"query": "dune"})]), text_message("Confirm below.")
    )
    (pending_id,) = (await agent.respond("u1", Tier.TRUSTED, "replace dune")).pending_ids
    pending = store.decide_pending(pending_id, "approved", "u1")
    outcome = await agent.resolve_confirmation("u1", Tier.TRUSTED, pending, approved=True)
    assert outcome.text.startswith("replaced") and not outcome.is_error
    *_, tool_use, result = store.recent_messages("u1", max_tokens=10_000)
    assert tool_use["content"][0]["name"] == "replace_media"
    stored = result["content"][0]
    assert stored["tool_use_id"] == tool_use["content"][0]["id"]
    assert stored["content"].endswith("…[truncated in memory]")


async def test_resolve_confirmation_records_a_cancel_without_running(world):
    make, store = world
    agent, _ = make(
        tool_message([("replace_media", {"query": "dune"})]), text_message("Confirm below.")
    )
    (pending_id,) = (await agent.respond("u1", Tier.TRUSTED, "replace dune")).pending_ids
    pending = store.decide_pending(pending_id, "denied", "u1")
    outcome = await agent.resolve_confirmation("u1", Tier.TRUSTED, pending, approved=False)
    assert "nothing was done" in outcome.text
    assert store.recent_messages("u1", max_tokens=10_000)[-1]["content"][0]["content"] == (
        outcome.text
    )


async def test_friend_tier_never_sees_trusted_tools_and_call_is_refused(world):
    make, _ = world
    agent, model = make(
        tool_message([("replace_media", {"query": "dune"})]), text_message("I can't do that.")
    )
    reply = await agent.respond("u1", Tier.FRIEND, "replace dune")
    assert [t["name"] for t in model.messages.calls[0]["tools"]] == ["search_media"]
    assert reply.tool_calls[0]["ok"] is False
    assert "not available" in model.messages.calls[1]["messages"][-1]["content"][0]["content"]


async def test_iteration_cap_stops_a_tool_loop(world):
    make, _ = world
    script = [
        tool_message([("search_media", {"query": "x"})]) for _ in range(MAX_TOOL_ITERATIONS + 1)
    ]
    agent, _ = make(*script)
    reply = await agent.respond("u1", Tier.FRIEND, "loop")
    assert reply.iterations == MAX_TOOL_ITERATIONS + 1
    assert "ran out of steps" in reply.text


async def test_refusal_and_truncation_are_handled(world):
    make, _ = world
    agent, _ = make(text_message("", stop_reason="refusal"))
    assert (await agent.respond("u1", Tier.FRIEND, "x")).text == "I can't help with that one."
    agent, _ = make(tool_message([("search_media", {"query": "x"})], stop_reason="max_tokens"))
    reply = await agent.respond("u1", Tier.FRIEND, "y")
    assert "cut off" in reply.text and reply.tool_calls == []


async def test_rate_limits_reply_without_calling_the_model(world):
    make, _ = world
    clock = [1_000_000.0]
    limiter = RateLimiter(messages_per_hour=2, tokens_per_day=100, clock=lambda: clock[0])
    agent, model = make(text_message("A"), text_message("B"), text_message("C"), limiter=limiter)
    await agent.respond("u1", Tier.FRIEND, "1")
    await agent.respond("u1", Tier.FRIEND, "2")
    reply = await agent.respond("u1", Tier.FRIEND, "3")
    assert isinstance(reply, AgentReply) and "message limit" in reply.text
    assert len(model.messages.calls) == 2
    clock[0] += 3601
    limiter.add_tokens("u1", 100)
    reply = await agent.respond("u1", Tier.FRIEND, "4")
    assert "daily usage limit" in reply.text
