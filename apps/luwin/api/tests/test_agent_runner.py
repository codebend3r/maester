from datetime import UTC, datetime, timedelta

import pytest

from luwin.agent.limits import KillSwitch
from luwin.agent.runner import CANCELLED, ToolRunner
from luwin.agent.tools import (
    MAX_CHOICES,
    Approval,
    Choice,
    Choices,
    Result,
    Tier,
    ToolContext,
    ToolRegistry,
    ToolSpec,
)
from luwin.config import Settings
from luwin.memo import Memo
from luwin.notify import AdminPost, ApprovalPost, DirectMessage
from luwin.store import LinkedUser, NotLinked, Store

SCHEMA_N = {"type": "object", "properties": {"n": {"type": "integer"}}, "required": ["n"]}
SCHEMA = {
    "type": "object",
    "properties": {"file_id": {"type": "integer"}, "host": {"type": "string"}},
    "required": ["file_id", "host"],
}
DAY = timedelta(days=1)
DECIDE_SCHEMA = {
    "type": "object",
    "properties": {"n": {"type": "integer"}, "approved": {"type": "boolean"}},
    "required": ["n", "approved"],
    "additionalProperties": False,
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
        if file_id == 9:
            return Result("deleted 9", (AdminPost("deleted /x/9.mkv, 4 GB, corrupt"),))
        return "deleted"

    @reg.tool("refuse", "explains its own failure", SCHEMA_N)
    async def refuse(ctx, n):
        return Result(f"not doing {n}", (AdminPost("tried and refused"),), is_error=True)

    @reg.tool(
        "escalate", "confirmed, then asks the admin", SCHEMA, tier=Tier.TRUSTED, destructive=True
    )
    async def escalate(ctx, file_id, host):
        approval = Approval("u1 wants a delete", "delete", "decide_n", {"n": file_id})
        return Result({"asked": file_id}, approval=approval)

    @reg.tool("tell_admin", "admin should know", SCHEMA_N)
    async def tell_admin(ctx, n):
        return Result({"done": n}, (AdminPost(f"heads up: {n}"),))

    @reg.tool("ask_admin", "needs the admin", SCHEMA_N)
    async def ask_admin(ctx, n):
        approval = Approval(f"u1 wants {n}", f"let u1 have {n}", "decide_n", {"n": n})
        return Result({"n": n}, approval=approval)

    @reg.tool("order", "asks a service for something", SCHEMA_N, held_in_maintenance=True)
    async def order(ctx, n):
        calls.append(("order", n))
        return {"ordered": n}

    @reg.tool(
        "swap_file",
        "destructive, and held in maintenance",
        SCHEMA,
        tier=Tier.TRUSTED,
        destructive=True,
        host_param="host",
        held_in_maintenance=True,
    )
    async def swap_file(ctx, file_id, host):
        calls.append(("swap_file", file_id))
        return "swapped"

    @reg.tool("ask_about", "asks the admin about one subject", SCHEMA_N)
    async def ask_about(ctx, n):
        approval = Approval(f"u1 wants {n}", f"{n} for u1", "decide_n", {"n": n}, f"thing:{n}")
        return Result({"n": n}, approval=approval)

    @reg.tool("ask_badly", "names no decide tool", SCHEMA_N)
    async def ask_badly(ctx, n):
        return Result({}, approval=Approval("u1 wants it", "?", "echo", {"n": n}))

    @reg.tool("decide_n", "the admin decides", DECIDE_SCHEMA, tier=Tier.ADMIN, button_only=True)
    async def decide_n(ctx, n, approved):
        if n < 0:
            raise ConnectionError("seerr down")
        calls.append(("decide_n", ctx.user_id, n, approved))
        return Result(f"decided {approved}", (DirectMessage("u1", "told you"),))

    store = Store(":memory:")
    kill = KillSwitch()
    runner = ToolRunner(reg, kill_switch=kill)

    def as_user(user_id, tier=Tier.TRUSTED):
        return ToolContext(user_id, tier, None, store, Settings(), Memo())

    yield runner, as_user, store, calls, kill
    store.close()


async def test_runs_and_audits_a_plain_tool(setup):
    runner, as_user, store, *_ = setup
    out = await runner.run(as_user("u1"), "echo", {"x": "hi"})
    assert out.content == {"echoed": "hi"} and not out.is_error
    row = store.audit_recent(1)[0]
    assert row.tool == "echo" and row.ok and row.args == {"x": "hi"} and row.discord_id == "u1"
    assert out.as_result_block("t1") == {
        "type": "tool_result",
        "tool_use_id": "t1",
        "content": '{"echoed": "hi"}',
    }


async def test_choices_result_is_typed_for_the_chat_and_serialized_for_the_model(setup):
    runner, as_user, *_ = setup
    out = await runner.run(as_user("u1"), "pick", {})
    assert out.choices == (Choice("Dune", "438631", 2021),)
    assert '"value": "438631"' in out.text and "buttons" in out.text
    assert "not_shown" not in out.content


def test_choices_past_the_button_cap_are_named_to_the_model():
    many = Choices([Choice(f"Part {n}", str(n)) for n in range(MAX_CHOICES + 2)])
    assert len(many.shown) == MAX_CHOICES
    content = many.as_content()
    assert len(content["choices"]) == MAX_CHOICES
    assert content["not_shown"] == ["Part 10 (10)", "Part 11 (11)"]


async def test_out_of_tier_unknown_and_button_only_tools_are_refused_and_audited(setup):
    runner, as_user, store, calls, _ = setup
    out = await runner.run(as_user("u2", Tier.FRIEND), "delete_file", {"file_id": 1, "host": "m"})
    assert out.is_error and "not available" in out.content
    assert (await runner.run(as_user("u1"), "nope", {})).is_error
    # Even the admin's model cannot call a button-only tool.
    out = await runner.run(as_user("boss", Tier.ADMIN), "decide_n", {"n": 1, "approved": True})
    assert out.is_error and "not available" in out.content
    assert [r.ok for r in store.audit_recent(5)] == [False, False, False]
    assert calls == []


async def test_invalid_input_is_returned_as_invalid_json(setup):
    runner, as_user, *_ = setup
    out = await runner.run(as_user("u1"), "echo", {"x": 5})
    assert out.is_error and "INVALID_JSON" in out.content
    # A model cannot smuggle a confirmation in with the input.
    out = await runner.run(as_user("u1"), "echo", {"x": "hi", "_confirmed_pending_id": 1})
    assert out.is_error and "unexpected argument" in out.content


async def test_tool_exceptions_become_retryable_error_results(setup):
    runner, as_user, store, *_ = setup
    out = await runner.run(as_user("u1"), "boom", {})
    assert out.is_error and out.retryable and "kaput" in out.content
    assert store.audit_recent(1)[0].ok is False


async def test_a_result_carries_its_notices(setup):
    runner, as_user, store, *_ = setup
    out = await runner.run(as_user("u1"), "tell_admin", {"n": 3})
    assert out.content == {"done": 3} and out.notices == (AdminPost("heads up: 3"),)
    assert store.open_pending() == []


async def test_an_approval_is_stored_as_a_pending_call_of_its_decide_tool(setup):
    runner, as_user, store, *_ = setup
    out = await runner.run(as_user("u1"), "ask_admin", {"n": 3})
    assert out.content["status"] == "awaiting_admin_approval" and out.content["result"] == {"n": 3}
    (post,) = out.notices
    assert post == ApprovalPost("u1 wants 3", out.approval_id)
    pending = store.get_pending(post.pending_id)
    assert (pending.kind, pending.action, pending.requester) == ("approve", "decide_n", "u1")
    assert pending.payload == {"n": 3} and pending.summary == "let u1 have 3"
    # The call asked rather than acted, and its audit row says so.
    assert store.audit_recent(1)[0].pending_id == pending.id


async def test_an_approval_that_cannot_be_decided_reaches_the_admin_anyway(setup):
    runner, as_user, store, *_ = setup
    out = await runner.run(as_user("u1"), "ask_badly", {"n": 1})
    assert out.is_error and "could not be asked" in out.content
    (post,) = out.notices
    assert isinstance(post, AdminPost) and post.text.startswith("u1 wants it")
    assert store.open_pending() == []


async def decided(store, runner, as_user, n=3, verdict="approved", by="boss"):
    out = await runner.run(as_user("u1"), "ask_admin", {"n": n})
    return store.decide_pending(out.approval_id, verdict, by)


async def test_an_admin_press_runs_the_decide_tool_as_the_admin(setup):
    runner, as_user, store, calls, _ = setup
    pending = await decided(store, runner, as_user)
    out = await runner.run_decision(as_user("boss", Tier.ADMIN), pending, True)
    assert out.content == "decided True" and out.notices == (DirectMessage("u1", "told you"),)
    assert calls == [("decide_n", "boss", 3, True)]
    row = store.audit_recent(1)[0]
    assert (row.tool, row.discord_id, row.args) == ("decide_n", "boss", {"n": 3, "approved": True})

    denied = await decided(store, runner, as_user, verdict="denied")
    await runner.run_decision(as_user("boss", Tier.ADMIN), denied, False)
    assert calls[-1] == ("decide_n", "boss", 3, False)


async def test_only_the_admin_who_decided_runs_it_and_only_their_way(setup):
    runner, as_user, store, calls, _ = setup
    pending = await decided(store, runner, as_user)
    for ctx, approved in [
        (as_user("boss", Tier.ADMIN), False),  # not the recorded decision
        (as_user("other", Tier.ADMIN), True),  # not who decided
        (as_user("boss", Tier.TRUSTED), True),  # not an admin
    ]:
        out = await runner.run_decision(ctx, pending, approved)
        assert out.is_error and not out.retryable
    open_one = store.get_pending(
        (await runner.run(as_user("u1"), "ask_admin", {"n": 4})).approval_id
    )
    assert (await runner.run_decision(as_user("boss", Tier.ADMIN), open_one, True)).is_error
    assert calls == []


async def test_a_failed_decide_is_retryable_and_a_vanished_tool_is_not(setup):
    runner, as_user, store, *_ = setup
    failing = await decided(store, runner, as_user, n=-1)
    out = await runner.run_decision(as_user("boss", Tier.ADMIN), failing, True)
    assert out.is_error and out.retryable and "seerr down" in out.content
    gone = store.create_pending(
        kind="approve", action="renamed_since", requester="u1", payload={}, summary="?", ttl=DAY
    )
    gone = store.decide_pending(gone.id, "approved", "boss")
    out = await runner.run_decision(as_user("boss", Tier.ADMIN), gone, True)
    assert out.is_error and not out.retryable and "no longer exists" in out.content


async def test_destructive_tool_needs_confirmation_then_runs_on_the_press(setup):
    runner, as_user, store, calls, _ = setup
    out = await runner.run(as_user("u1"), "delete_file", {"file_id": 7, "host": "meleys"})
    assert out.content["status"] == "awaiting_confirmation" and out.pending_id
    assert "on meleys" in out.content["summary"]
    assert calls == [] and store.audit_recent(5) == []  # nothing ran, so nothing audited

    pending = store.decide_pending(out.pending_id, "approved", "u1")
    done = await runner.run_decision(as_user("u1"), pending, True)
    assert done.content == "deleted" and calls == [("delete_file", 7, "meleys")]
    assert store.audit_recent(1)[0].host == "meleys"
    (notice,) = done.notices
    assert notice.text.startswith("u1 confirmed: delete_file on meleys")


async def test_a_confirmed_tool_that_posts_its_own_notice_is_not_announced_twice(setup):
    runner, as_user, store, *_ = setup
    store.upsert_user("u1", status="active", seerr_user_id=4, plex_username="trusty")
    out = await runner.run(as_user("u1"), "delete_file", {"file_id": 9, "host": "meleys"})
    pending = store.decide_pending(out.pending_id, "approved", "u1")
    done = await runner.run_decision(as_user("u1"), pending, True)
    assert done.notices == (AdminPost("deleted /x/9.mkv, 4 GB, corrupt"),)
    out = await runner.run(as_user("u1"), "delete_file", {"file_id": 7, "host": "meleys"})
    pending = store.decide_pending(out.pending_id, "approved", "u1")
    (generic,) = (await runner.run_decision(as_user("u1"), pending, True)).notices
    assert generic.text.startswith("trusty confirmed")


async def test_a_tool_can_fail_on_its_own_terms_and_is_audited_as_not_ok(setup):
    runner, as_user, store, *_ = setup
    out = await runner.run(as_user("u1"), "refuse", {"n": 3})
    assert out.is_error and not out.retryable and out.content == "not doing 3"
    assert out.notices == (AdminPost("tried and refused"),)
    assert store.audit_recent(1)[0].ok is False
    assert store.audit_count_since("refuse", datetime.now(UTC) - DAY) == 0


async def test_a_confirmed_call_that_asks_the_admin_is_announced_by_its_approval_alone(setup):
    runner, as_user, store, *_ = setup
    out = await runner.run(as_user("u1"), "escalate", {"file_id": 4, "host": "meleys"})
    pending = store.decide_pending(out.pending_id, "approved", "u1")
    asked = await runner.run_decision(as_user("u1"), pending, True)
    (post,) = asked.notices
    assert isinstance(post, ApprovalPost) and post.pending_id == asked.approval_id


async def test_a_cancel_runs_nothing_and_a_confirmation_is_the_requesters_own(setup):
    runner, as_user, store, calls, _ = setup
    out = await runner.run(as_user("u1"), "delete_file", {"file_id": 7, "host": "meleys"})
    cancelled = store.decide_pending(out.pending_id, "denied", "u1")
    assert await runner.run_decision(as_user("u1"), cancelled, False) is CANCELLED

    other = await runner.run(as_user("u9"), "delete_file", {"file_id": 7, "host": "meleys"})
    theirs = store.decide_pending(other.pending_id, "approved", "u9")
    assert (await runner.run_decision(as_user("u1"), theirs, True)).is_error
    assert calls == []


async def test_kill_switch_blocks_destructive_tools_only(setup):
    runner, as_user, store, _, kill = setup
    kill.on("maintenance")
    out = await runner.run(as_user("u1"), "delete_file", {"file_id": 7, "host": "meleys"})
    assert out.is_error and out.retryable and "maintenance" in out.content
    assert not (await runner.run(as_user("u1"), "echo", {"x": "still fine"})).is_error
    kill.off()
    out = await runner.run(as_user("u1"), "delete_file", {"file_id": 7, "host": "meleys"})
    pending = store.decide_pending(out.pending_id, "approved", "u1")
    kill.on("maintenance")
    held = await runner.run_decision(as_user("u1"), pending, True)
    assert held.is_error and held.retryable


def test_linked_user_is_the_active_seerr_link_or_a_refusal(setup):
    _, as_user, store, *_ = setup
    ctx = as_user("u1")
    with pytest.raises(NotLinked):
        ctx.linked_user()
    store.upsert_user("u1", status="pending", seerr_user_id=4)
    with pytest.raises(NotLinked):
        ctx.linked_user()
    store.upsert_user("u1", status="active")
    assert ctx.linked_user() == LinkedUser("u1", 4, None, "u1")
    store.upsert_user("u1", plex_email="u1@example.com")
    assert ctx.link_of("u1").name == "u1@example.com"


def test_button_only_tools_are_admin_tools_hidden_from_every_tier():
    reg = ToolRegistry()

    @reg.tool("decide", "d", DECIDE_SCHEMA, tier=Tier.ADMIN, button_only=True)
    async def decide(ctx, n, approved):
        return None

    assert reg.for_tier(Tier.ADMIN) == [] and reg.get("decide").button_only
    with pytest.raises(ValueError, match="must be admin tier"):
        reg.tool("friendly", "f", DECIDE_SCHEMA, button_only=True)(decide)


def test_a_result_is_either_an_answer_a_failure_or_a_question_for_the_admin():
    ask = Approval("u1 wants it", "let u1", "decide_n", {"n": 1})
    with pytest.raises(ValueError, match="isn't a failure"):
        Result({}, approval=ask, is_error=True)
    with pytest.raises(ValueError, match="only a failure can be retried"):
        Result({}, retryable=True)
    assert Result.refusal("no", AdminPost("tried")) == Result(
        "no", (AdminPost("tried"),), is_error=True
    )


async def test_a_caller_with_no_link_is_refused_like_any_refusal(setup):
    runner, as_user, store, *_ = setup
    runner.registry.register(
        ToolSpec("acts", "acts as the caller", {"type": "object", "properties": {}}, acts)
    )
    out = await runner.run(as_user("nobody"), "acts", {})
    assert out.is_error and not out.retryable and "isn't linked" in out.content
    assert store.audit_recent(1)[0].ok is False


async def acts(ctx):
    return {"as": ctx.linked_user().seerr_user_id}


async def test_an_approval_about_a_subject_already_open_is_not_posted_twice(setup):
    runner, as_user, *_ = setup
    first = await runner.run(as_user("u1"), "ask_about", {"n": 5})
    (post,) = first.notices
    again = await runner.run(as_user("u2"), "ask_about", {"n": 5})
    assert again.approval_id == first.approval_id == post.pending_id
    assert again.notices == () and again.content["status"] == "awaiting_admin_approval"
    other = await runner.run(as_user("u1"), "ask_about", {"n": 6})
    assert isinstance(other.notices[0], ApprovalPost) and other.approval_id != first.approval_id


async def test_maintenance_holds_a_call_and_it_runs_as_its_caller_afterwards(setup):
    runner, as_user, store, calls, _ = setup
    store.raise_flag("maintenance", "new drives")
    out = await runner.run(as_user("u1"), "order", {"n": 3})
    assert out.content["status"] == "held_for_maintenance" and out.held_id is not None
    assert out.content["maintenance"] == "new drives" and calls == []
    assert not (await runner.run(as_user("u1"), "echo", {"x": "still answers"})).is_error
    (held,) = store.held_calls()
    assert store.audit_count_since("order", datetime.now(UTC) - DAY) == 0  # held, not done
    store.lower_flag("maintenance")
    done = await runner.run_held(as_user("u1"), held)
    assert done.content == {"ordered": 3} and calls[-1] == ("order", 3)
    assert store.audit_count_since("order", datetime.now(UTC) - DAY) == 1


async def test_a_destructive_call_is_confirmed_first_and_held_on_the_press(setup):
    runner, as_user, store, calls, kill = setup
    store.raise_flag("maintenance")
    asked = await runner.run(as_user("u1"), "swap_file", {"file_id": 7, "host": "meleys"})
    assert asked.pending_id is not None  # the friend still confirms it
    pending = store.decide_pending(asked.pending_id, "approved", "u1")
    held = await runner.run_decision(as_user("u1"), pending, True)
    assert held.held_id is not None and held.notices == () and calls == []
    store.lower_flag("maintenance")
    (call,) = store.held_calls()
    kill.on("not now")
    stopped = await runner.run_held(as_user("u1"), call)
    assert stopped.is_error and "not now" in stopped.content and calls == []
    kill.off()
    assert (await runner.run_held(as_user("u1"), call)).content == "swapped"


async def test_a_held_call_that_no_longer_fits_its_caller_is_refused(setup):
    runner, as_user, store, calls, _ = setup
    store.raise_flag("maintenance")
    await runner.run(as_user("u1"), "order", {"n": 1})
    (held,) = store.held_calls()
    store.lower_flag("maintenance")
    out = await runner.run_held(as_user("u1", Tier.UNLINKED), held)
    assert out.is_error and "no longer available" in out.content and calls == []
