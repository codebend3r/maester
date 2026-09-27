from datetime import UTC, datetime, timedelta

import pytest

from maester.store import Store


@pytest.fixture
def store():
    s = Store(":memory:")
    yield s
    s.close()


def test_migrations_apply_once(store):
    assert store.migrate() == []
    tables = {
        r[0]
        for r in store._conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert {"users", "conversations", "audit_log", "reports", "pending_actions"} <= tables


def test_audit_records_and_reads_back_newest_first(store):
    store.audit(
        discord_id="u1", tool="search_media", args={"query": "dune"}, result=[1, 2], ok=True
    )
    store.audit(
        discord_id="u1",
        tool="replace_media",
        args={"id": 5},
        result="boom",
        ok=False,
        host="meleys",
    )
    rows = store.audit_recent(10)
    assert [r.tool for r in rows] == ["replace_media", "search_media"]
    assert rows[0].ok is False and rows[0].host == "meleys"
    assert rows[1].args == {"query": "dune"} and rows[1].result == [1, 2]
    assert store.audit_recent(10, tool="search_media")[0].tool == "search_media"


def test_audit_result_is_truncated_and_non_json_is_stringified(store):
    store.audit(discord_id=None, tool="t", args={}, result={"blob": "x" * 10_000}, ok=True)
    stored = store.audit_recent(1)[0].result
    assert stored["truncated"] is True and len(stored["preview"]) == 4000
    store.audit(
        discord_id=None, tool="t", args={"when": datetime(2026, 1, 1)}, result=object(), ok=True
    )
    assert "2026-01-01" in store.audit_recent(1)[0].args["when"]


def test_audit_count_since_counts_only_successes(store):
    store.audit(discord_id="u", tool="replace_media", args={}, result=None, ok=True)
    store.audit(discord_id="u", tool="replace_media", args={}, result=None, ok=False)
    since = datetime.now(UTC) - timedelta(days=1)
    assert store.audit_count_since("replace_media", since) == 1
    assert store.audit_count_since("replace_media", datetime.now(UTC) + timedelta(minutes=1)) == 0


def test_user_upsert_and_lookup(store):
    assert store.get_user("d1") is None
    row = store.upsert_user("d1", plex_email="a@b.c", seerr_user_id=4, status="active")
    assert row.seerr_user_id == 4 and row.status == "active" and row.tier_override is None
    assert store.upsert_user("d1", tier_override="trusted").tier_override == "trusted"
    with pytest.raises(ValueError, match="unknown user fields"):
        store.upsert_user("d1", nope=1)


def test_conversation_window_respects_token_budget(store):
    for i in range(5):
        store.append_message("d1", "user" if i % 2 == 0 else "assistant", f"m{i}", tokens=10)
    window = store.recent_messages("d1", max_tokens=35)
    assert [m["content"] for m in window] == ["m2", "m3", "m4"]
    # A budget that lands on an assistant message trims forward to the next
    # user message, so the window never opens mid-exchange.
    assert [m["content"] for m in store.recent_messages("d1", max_tokens=25)] == ["m4"]
    assert store.recent_messages("d1", max_tokens=5) == [{"role": "user", "content": "m4"}]
    assert store.clear_messages("d1") == 5
    assert store.recent_messages("d1", max_tokens=100) == []


def test_pending_action_is_decided_once(store):
    p = store.create_pending(
        kind="confirm",
        action="replace_media",
        requester="d1",
        payload={"id": 5},
        summary="Replace Dune",
        ttl=timedelta(minutes=5),
    )
    assert p.decision is None and store.open_pending("confirm") == [p]
    decided = store.decide_pending(p.id, "approved", "d1")
    assert decided.decision == "approved"
    assert store.decide_pending(p.id, "denied", "d2") is None
    assert store.open_pending() == []


def test_expired_pending_action_cannot_be_decided(store):
    p = store.create_pending(
        kind="approve",
        action="request_4k",
        requester="d1",
        payload={},
        summary="4K Dune",
        ttl=timedelta(seconds=-1),
    )
    assert store.open_pending() == []
    assert store.decide_pending(p.id, "approved", "admin") is None


def test_calls_inside_a_transaction_commit_or_roll_back_together(store):
    with store.transaction():
        store.upsert_user("d1", status="pending")
        store.upsert_user("d2", status="pending")
    assert store.get_user("d1") and store.get_user("d2")

    with pytest.raises(RuntimeError), store.transaction():
        store.upsert_user("d3", status="pending")
        raise RuntimeError("boom")
    assert store.get_user("d3") is None
    store.upsert_user("d4")  # the store is usable again after a rollback
    assert store.get_user("d4")


def test_a_decision_records_who_and_can_be_reopened(store):
    p = store.create_pending(
        kind="approve",
        action="request_media_4k",
        requester="d1",
        payload={},
        summary="4K Dune",
        ttl=timedelta(days=1),
    )
    assert store.decide_pending(p.id, "approved", "boss").decided_by == "boss"
    store.reopen_pending(p.id)
    reopened = store.get_pending(p.id)
    assert reopened.decision is None and reopened.decided_by is None
    assert store.open_pending("approve") == [reopened]
