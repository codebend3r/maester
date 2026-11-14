from datetime import UTC, datetime, timedelta

import pytest

from sparrow.agent.runner import Cancelled, Done, Errored, ToolRunner
from sparrow.agent.tools import (
    MAX_CHOICES,
    Choice,
    Failed,
    Ok,
    Refused,
    Tier,
    ToolContext,
    ToolRegistry,
    ToolSpec,
    offer,
)
from sparrow.config import Settings
from sparrow.memo import Memo
from sparrow.notify import AdminPost
from sparrow.store import Decision, LinkedUser, NotLinked, Store

DAY = timedelta(days=1)


@pytest.fixture
def setup():
    reg = ToolRegistry()
    calls = []

    @reg.tool("echo", "echo")
    async def echo(ctx, x: str):
        calls.append(("echo", x))
        return {"echoed": x}

    @reg.tool("pick", "offers options")
    async def pick(ctx):
        return offer([Choice("Dune", "438631", 2021)])

    @reg.tool("boom", "fails")
    async def boom(ctx):
        raise RuntimeError("kaput")

    @reg.tool("delete_file", "destructive", tier=Tier.TRUSTED, destructive=True, host_param="host")
    async def delete_file(ctx, file_id: int, host: str):
        calls.append(("delete_file", file_id, host))
        if file_id == 9:
            return Ok("deleted 9", (AdminPost("deleted /x/9.mkv, 4 GB, corrupt"),))
        if file_id < 0:
            raise ConnectionError("arr down")
        return "deleted"

    @reg.tool("refuse", "explains its own failure")
    async def refuse(ctx, n: int):
        return Refused(f"not doing {n}", (AdminPost("tried and refused"),))

    @reg.tool("tell_admin", "admin should know")
    async def tell_admin(ctx, n: int):
        return Ok({"done": n}, (AdminPost(f"heads up: {n}"),))

    store = Store(":memory:")
    runner = ToolRunner(reg)

    def as_user(user_id, tier=Tier.TRUSTED):
        return ToolContext(user_id, tier, None, store, Settings(), Memo())

    yield runner, as_user, store, calls
    store.close()


async def confirmed(runner, as_user, store, user_id="u1", file_id=7, decision=Decision.APPROVED):
    out = await runner.run(as_user(user_id), "delete_file", {"file_id": file_id, "host": "meleys"})
    return store.decide_pending(out.status.pending_id, decision, user_id)


async def test_runs_and_audits_a_plain_tool(setup):
    runner, as_user, store, _ = setup
    out = await runner.run(as_user("u1"), "echo", {"x": "hi"})
    assert out.content == {"echoed": "hi"} and not out.is_error
    row = store.audit_recent(1)[0]
    assert row.tool == "echo" and row.ok and row.args == {"x": "hi"} and row.user_id == "u1"
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
    many = offer([Choice(f"Part {n}", str(n)) for n in range(MAX_CHOICES + 2)], ["one is off"])
    assert len(many.choices) == MAX_CHOICES
    assert len(many.content["choices"]) == MAX_CHOICES
    assert many.content["not_shown"] == ["Part 10 (10)", "Part 11 (11)"]
    assert many.content["notes"] == ["one is off"]


async def test_out_of_tier_and_unknown_tools_are_refused_and_audited(setup):
    runner, as_user, store, calls = setup
    out = await runner.run(as_user("u2", Tier.FRIEND), "delete_file", {"file_id": 1, "host": "m"})
    assert out.is_error and "not available" in out.content
    assert (await runner.run(as_user("u1"), "nope", {})).is_error
    assert [r.ok for r in store.audit_recent(5)] == [False, False]
    assert calls == []


async def test_invalid_input_is_returned_as_invalid_json(setup):
    runner, as_user, *_ = setup
    out = await runner.run(as_user("u1"), "echo", {"x": 5})
    assert out.is_error and "INVALID_JSON" in out.content
    # A model cannot smuggle a confirmation in with the input.
    out = await runner.run(as_user("u1"), "echo", {"x": "hi", "_confirmed_pending_id": 1})
    assert out.is_error and "unexpected argument" in out.content


async def test_tool_exceptions_become_retryable_error_results(setup):
    runner, as_user, store, _ = setup
    out = await runner.run(as_user("u1"), "boom", {})
    assert out.status == Errored(retryable=True) and "kaput" in out.content
    assert store.audit_recent(1)[0].ok is False


async def test_a_result_carries_its_notices(setup):
    runner, as_user, *_ = setup
    out = await runner.run(as_user("u1"), "tell_admin", {"n": 3})
    assert out.content == {"done": 3} and out.notices == (AdminPost("heads up: 3"),)


async def test_destructive_tool_needs_confirmation_then_runs_on_the_press(setup):
    runner, as_user, store, calls = setup
    out = await runner.run(as_user("u1"), "delete_file", {"file_id": 7, "host": "meleys"})
    assert out.content["status"] == "awaiting_confirmation" and out.status.pending_id
    assert "on meleys" in out.content["summary"]
    assert calls == [] and store.audit_recent(5) == []  # nothing ran, so nothing audited

    pending = store.decide_pending(out.status.pending_id, Decision.APPROVED, "u1")
    done = await runner.run_decision(as_user("u1"), pending, True)
    assert done.content == "deleted" and calls == [("delete_file", 7, "meleys")]
    assert store.audit_recent(1)[0].host == "meleys"
    (notice,) = done.notices
    assert notice.text.startswith("u1 confirmed: delete_file on meleys")


async def test_a_confirmed_tool_that_posts_its_own_notice_is_not_announced_twice(setup):
    runner, as_user, store, _ = setup
    store.upsert_user("u1", seerr_user_id=4, plex_username="trusty")
    pending = await confirmed(runner, as_user, store, file_id=9)
    done = await runner.run_decision(as_user("u1"), pending, True)
    assert done.notices == (AdminPost("deleted /x/9.mkv, 4 GB, corrupt"),)
    pending = await confirmed(runner, as_user, store)
    (generic,) = (await runner.run_decision(as_user("u1"), pending, True)).notices
    assert generic.text.startswith("trusty confirmed")


async def test_a_failed_press_is_retryable(setup):
    runner, as_user, store, _ = setup
    pending = await confirmed(runner, as_user, store, file_id=-1)
    out = await runner.run_decision(as_user("u1"), pending, True)
    assert out.status == Errored(retryable=True) and "arr down" in out.content


async def test_a_press_for_a_tool_that_no_longer_exists_is_refused(setup):
    runner, as_user, store, _ = setup
    gone = store.create_pending(
        action="renamed_since", requester="u1", payload={}, summary="?", ttl=DAY
    )
    gone = store.decide_pending(gone.id, Decision.APPROVED, "u1")
    out = await runner.run_decision(as_user("u1"), gone, True)
    assert out.status == Errored() and "not available" in out.content


async def test_a_tool_can_fail_on_its_own_terms_and_is_audited_as_not_ok(setup):
    runner, as_user, store, _ = setup
    out = await runner.run(as_user("u1"), "refuse", {"n": 3})
    assert out.status == Errored() and out.content == "not doing 3"
    assert out.notices == (AdminPost("tried and refused"),)
    assert store.audit_recent(1)[0].ok is False
    assert store.audit_count_since("refuse", datetime.now(UTC) - DAY) == 0


async def test_a_cancel_runs_nothing_and_a_confirmation_is_the_requesters_own(setup):
    runner, as_user, store, calls = setup
    cancelled = await confirmed(runner, as_user, store, decision=Decision.DENIED)
    assert (await runner.run_decision(as_user("u1"), cancelled, False)).status == Cancelled()

    theirs = await confirmed(runner, as_user, store, user_id="u9")
    assert (await runner.run_decision(as_user("u1"), theirs, True)).is_error
    undecided = store.create_pending(
        action="delete_file", requester="u1", payload={"file_id": 1, "host": "m"}, summary="?",
        ttl=DAY,
    )  # fmt: skip
    assert (await runner.run_decision(as_user("u1"), undecided, True)).is_error
    assert calls == []


async def test_only_a_destructive_tool_runs_from_a_press(setup):
    runner, as_user, store, calls = setup
    plain = store.create_pending(
        action="echo", requester="u1", payload={"x": "hi"}, summary="?", ttl=DAY
    )
    plain = store.decide_pending(plain.id, Decision.APPROVED, "u1")
    assert (await runner.run_decision(as_user("u1"), plain, True)).is_error
    assert calls == []


def test_linked_user_is_the_active_seerr_link_or_a_refusal(setup):
    _, as_user, store, _ = setup
    ctx = as_user("u1")
    with pytest.raises(NotLinked):
        ctx.linked_user()
    store.upsert_user("u1", tier_override="trusted")  # an override alone links nobody
    with pytest.raises(NotLinked):
        ctx.linked_user()
    store.upsert_user("u1", seerr_user_id=4)
    assert ctx.linked_user() == LinkedUser("u1", 4, None, "u1")
    store.upsert_user("u1", plex_email="u1@example.com")
    assert ctx.linked_user().name == "u1@example.com"


async def test_each_kind_of_result_becomes_its_own_status(setup):
    runner, as_user, *_ = setup
    runner.registry.register(ToolSpec("flaky", "a step failed, worth trying again", flaky))
    assert (await runner.run(as_user("u1"), "tell_admin", {"n": 1})).status == Done()
    assert (await runner.run(as_user("u1"), "refuse", {"n": 1})).status == Errored()
    assert (await runner.run(as_user("u1"), "flaky", {})).status == Errored(retryable=True)


async def flaky(ctx):
    return Failed("Seerr didn't answer", retryable=True)


async def test_a_caller_with_no_link_is_refused_like_any_refusal(setup):
    runner, as_user, store, _ = setup
    runner.registry.register(ToolSpec("acts", "acts as the caller", acts))
    out = await runner.run(as_user("nobody"), "acts", {})
    assert out.status == Errored() and "isn't linked" in out.content
    assert store.audit_recent(1)[0].ok is False


async def acts(ctx):
    return {"as": ctx.linked_user().seerr_user_id}
