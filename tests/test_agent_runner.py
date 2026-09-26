import pytest

from maester.agent.limits import KillSwitch
from maester.agent.runner import CONFIRMED_KEY, ToolRunner
from maester.agent.tools import Tier, ToolContext, ToolRegistry
from maester.store import Store

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

    @reg.tool("boom", "fails", {"type": "object", "properties": {}})
    async def boom(ctx):
        raise RuntimeError("kaput")

    @reg.tool(
        "delete_file", "destructive", SCHEMA, tier=Tier.TRUSTED, destructive=True, host_param="host"
    )
    async def delete_file(ctx, file_id, host):
        calls.append(("delete_file", file_id, host))
        return "deleted"

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
