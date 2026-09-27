from datetime import timedelta

import pytest

from maester.agent.limits import KillSwitch
from maester.agent.runner import CONFIRMED_KEY, ToolRunner
from maester.agent.tools import (
    MAX_CHOICES,
    Approval,
    Choice,
    Choices,
    ForAdmin,
    LinkedUser,
    NotLinked,
    Settled,
    Tier,
    ToolContext,
    ToolRegistry,
)
from maester.notify import AdminPost, DirectMessage
from maester.store import Store

SCHEMA_N = {"type": "object", "properties": {"n": {"type": "integer"}}, "required": ["n"]}
SCHEMA = {
    "type": "object",
    "properties": {"file_id": {"type": "integer"}, "host": {"type": "string"}},
    "required": ["file_id", "host"],
}


@pytest.fixture
def setup():
    reg = ToolRegistry()
    calls = []

    @reg.tool(
        "echo",
        "echo",
        {"type": "object", "properties": {"x": {"type": "string"}}, "required": ["x"]},
    )
    async def echo(ctx, x):
        calls.append(("echo", x))
        return {"echoed": x}

    @reg.tool("pick", "offers options", {"type": "object", "properties": {}})
    async def pick(ctx):
        return Choices([Choice("Dune", "438631", 2021)])

    @reg.tool("boom", "fails", {"type": "object", "properties": {}})
    async def boom(ctx):
        raise RuntimeError("kaput")

    @reg.tool(
        "delete_file", "destructive", SCHEMA, tier=Tier.TRUSTED, destructive=True, host_param="host"
    )
    async def delete_file(ctx, file_id, host):
        calls.append(("delete_file", file_id, host))
        return "deleted"

    async def settle_ask(ctx, pending, approved):
        if pending.payload["n"] < 0:
            raise RuntimeError("seerr down")
        calls.append(("settle_ask", ctx.user_id, pending.payload["n"], approved))
        return Settled(f"settled {approved}", (DirectMessage(pending.requester, "told you"),))

    @reg.tool("ask_admin", "needs the admin", SCHEMA_N, settle=settle_ask)
    async def ask_admin(ctx, n):
        return ForAdmin({"n": n}, f"u1 wants {n}", Approval(f"let u1 have {n}", {"n": n}))

    @reg.tool("tell_admin", "admin should know", SCHEMA_N)
    async def tell_admin(ctx, n):
        return ForAdmin({"done": n}, f"heads up: {n}")

    @reg.tool("ask_without_settle", "misdeclared", SCHEMA_N)
    async def ask_without_settle(ctx, n):
        return ForAdmin({}, "?", Approval("?", {}))

    store = Store(":memory:")
    kill = KillSwitch()
    runner = ToolRunner(reg, kill_switch=kill)
    ctx = ToolContext(user_id="u1", tier=Tier.TRUSTED, services=None, store=store)
    yield runner, ctx, store, calls, kill
    store.close()


async def test_runs_and_audits_a_plain_tool(setup):
    runner, ctx, store, _, _ = setup
    out = await runner.run(ctx, "echo", {"x": "hi"})
    assert out.content == {"echoed": "hi"} and not out.is_error
    row = store.audit_recent(1)[0]
    assert row.tool == "echo" and row.ok and row.args == {"x": "hi"} and row.discord_id == "u1"
    assert out.as_result_block("t1") == {
        "type": "tool_result",
        "tool_use_id": "t1",
        "content": '{"echoed": "hi"}',
    }


async def test_choices_result_is_typed_for_the_chat_and_serialized_for_the_model(setup):
    runner, ctx, *_ = setup
    out = await runner.run(ctx, "pick", {})
    assert out.choices == (Choice("Dune", "438631", 2021),)
    assert '"value": "438631"' in out.text and "buttons" in out.text
    assert "not_shown" not in out.content


def test_choices_past_the_button_cap_are_named_to_the_model():
    many = Choices([Choice(f"Part {n}", str(n)) for n in range(MAX_CHOICES + 2)])
    assert len(many.shown) == MAX_CHOICES
    content = many.as_content()
    assert len(content["choices"]) == MAX_CHOICES
    assert content["not_shown"] == ["Part 10 (10)", "Part 11 (11)"]


async def test_out_of_tier_and_unknown_tools_are_rejected_and_audited(setup):
    runner, ctx, store, calls, _ = setup
    friend = ToolContext(user_id="u2", tier=Tier.FRIEND, services=None, store=store)
    out = await runner.run(friend, "delete_file", {"file_id": 1, "host": "meleys"})
    assert out.is_error and "not available" in out.content
    out = await runner.run(ctx, "nope", {})
    assert out.is_error
    assert [r.ok for r in store.audit_recent(5)] == [False, False]
    assert calls == []


async def test_invalid_input_is_returned_as_invalid_json(setup):
    runner, ctx, *_ = setup
    out = await runner.run(ctx, "echo", {"x": 5})
    assert out.is_error and "INVALID_JSON" in out.content


async def test_tool_exceptions_become_error_results(setup):
    runner, ctx, store, *_ = setup
    out = await runner.run(ctx, "boom", {})
    assert out.is_error and "kaput" in out.content
    assert store.audit_recent(1)[0].ok is False


async def test_destructive_tool_needs_confirmation_then_runs(setup):
    runner, ctx, store, calls, _ = setup
    out = await runner.run(ctx, "delete_file", {"file_id": 7, "host": "meleys"})
    assert out.content["status"] == "awaiting_confirmation" and out.pending_id
    assert "on meleys" in out.content["summary"]
    assert calls == []
    # Nothing ran, so nothing was audited as a delete.
    assert store.audit_recent(5) == []

    store.decide_pending(out.pending_id, "approved", "u1")
    out2 = await runner.run(
        ctx, "delete_file", {"file_id": 7, "host": "meleys", CONFIRMED_KEY: out.pending_id}
    )
    assert out2.content == "deleted" and calls == [("delete_file", 7, "meleys")]
    assert store.audit_recent(1)[0].host == "meleys"


async def test_confirmation_by_someone_else_or_denied_is_refused(setup):
    runner, ctx, store, calls, _ = setup
    out = await runner.run(ctx, "delete_file", {"file_id": 7, "host": "meleys"})
    store.decide_pending(out.pending_id, "denied", "u1")
    out2 = await runner.run(
        ctx, "delete_file", {"file_id": 7, "host": "meleys", CONFIRMED_KEY: out.pending_id}
    )
    assert out2.is_error and calls == []

    other = ToolContext(user_id="u9", tier=Tier.TRUSTED, services=None, store=store)
    out3 = await runner.run(other, "delete_file", {"file_id": 7, "host": "meleys"})
    store.decide_pending(out3.pending_id, "approved", "u9")
    out4 = await runner.run(
        ctx, "delete_file", {"file_id": 7, "host": "meleys", CONFIRMED_KEY: out3.pending_id}
    )
    assert out4.is_error and calls == []


async def test_kill_switch_blocks_destructive_tools_only(setup):
    runner, ctx, _, _, kill = setup
    kill.on("maintenance")
    out = await runner.run(ctx, "delete_file", {"file_id": 7, "host": "meleys"})
    assert out.is_error and "maintenance" in out.content
    out = await runner.run(ctx, "echo", {"x": "still fine"})
    assert not out.is_error
    kill.off()
    out = await runner.run(ctx, "delete_file", {"file_id": 7, "host": "meleys"})
    assert out.pending_id


async def test_a_notice_for_the_admin_rides_along_with_the_result(setup):
    runner, ctx, store, *_ = setup
    out = await runner.run(ctx, "tell_admin", {"n": 3})
    assert out.content == {"done": 3} and out.notices == (AdminPost("heads up: 3"),)
    assert store.open_pending() == []


async def test_an_approval_becomes_a_pending_action_the_admin_sees(setup):
    runner, ctx, store, *_ = setup
    out = await runner.run(ctx, "ask_admin", {"n": 3})
    assert out.content["status"] == "awaiting_admin_approval"
    assert out.content["result"] == {"n": 3} and not out.is_error
    (notice,) = out.notices
    pending = store.get_pending(notice.pending_id)
    assert notice.text == "u1 wants 3"
    assert (pending.kind, pending.action, pending.requester) == ("approve", "ask_admin", "u1")
    assert pending.payload == {"n": 3} and pending.summary == "let u1 have 3"
    assert store.open_pending("approve") == [pending]


async def test_an_approval_from_a_tool_that_cannot_settle_it_is_an_error(setup):
    runner, ctx, store, *_ = setup
    out = await runner.run(ctx, "ask_without_settle", {"n": 1})
    assert out.is_error and "no settle handler" in out.content
    assert store.open_pending() == []


async def test_settle_applies_the_decision_as_the_admin_and_audits_it(setup):
    runner, ctx, store, calls, _ = setup
    pending = store.get_pending(
        (await runner.run(ctx, "ask_admin", {"n": 3})).notices[0].pending_id
    )
    admin = ToolContext(user_id="boss", tier=Tier.ADMIN, services=None, store=store)
    settled = await runner.settle(admin, pending, True)
    assert settled.text == "settled True" and settled.notices[0].to == "u1"
    assert calls == [("settle_ask", "boss", 3, True)]
    row = store.audit_recent(1)[0]
    assert (row.tool, row.discord_id, row.ok) == ("ask_admin", "boss", True)
    assert row.args == {"n": 3, "pending_id": pending.id, "approved": True}


async def test_settle_failures_are_audited_and_raised(setup):
    runner, ctx, store, *_ = setup
    pending = store.get_pending(
        (await runner.run(ctx, "ask_admin", {"n": -1})).notices[0].pending_id
    )
    admin = ToolContext(user_id="boss", tier=Tier.ADMIN, services=None, store=store)
    with pytest.raises(RuntimeError, match="seerr down"):
        await runner.settle(admin, pending, True)
    assert store.audit_recent(1)[0].ok is False
    stray = store.create_pending(
        kind="approve", action="echo", requester="u1", payload={}, summary="?", ttl=timedelta(1)
    )
    with pytest.raises(LookupError, match="no tool settles"):
        await runner.settle(admin, stray, True)


def test_linked_user_is_the_active_seerr_link_or_a_refusal(setup):
    _, ctx, store, *_ = setup
    with pytest.raises(NotLinked):
        ctx.linked_user()
    store.upsert_user("u1", status="pending", seerr_user_id=4)
    with pytest.raises(NotLinked):
        ctx.linked_user()
    store.upsert_user("u1", status="active")
    assert ctx.linked_user() == LinkedUser("u1", 4, "u1")
    store.upsert_user("u1", plex_email="u1@example.com")
    assert ctx.linked_user().name == "u1@example.com"
