import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from sparrow.store import Decision, Store
from sparrow.store.base import APPLICATION_ID, OldDatabase
from sparrow.store.conversations import Role, StoredMessage


def test_migrations_apply_once(store):
    assert store.migrate() == []
    tables = {
        r[0]
        for r in store._conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert {"users", "conversations", "audit_log", "reports", "pending_actions"} <= tables


def test_a_new_database_is_sparrows_and_keyed_by_user_id(tmp_path):
    store = Store(tmp_path / "sparrow.db")
    assert store._conn.execute("PRAGMA application_id").fetchone()[0] == APPLICATION_ID
    for table in ("users", "conversations", "audit_log", "reports"):
        columns = {r["name"] for r in store._conn.execute(f"PRAGMA table_info({table})")}
        assert "user_id" in columns, table
    store.close()


def test_a_database_from_before_the_fresh_start_is_refused(tmp_path):
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.execute("CREATE TABLE schema_version (version INTEGER PRIMARY KEY)")
    old.execute("INSERT INTO schema_version VALUES (12)")
    old.commit()
    old.close()
    with pytest.raises(OldDatabase, match="before sparrow's fresh start"):
        Store(path)
    left = sqlite3.connect(path)
    assert left.execute("SELECT version FROM schema_version").fetchall() == [(12,)]
    left.close()


def test_audit_records_and_reads_back_newest_first(store):
    store.audit(user_id="u1", tool="search_media", args={"query": "dune"}, result=[1, 2], ok=True)
    store.audit(
        user_id="u1",
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
    store.audit(user_id=None, tool="t", args={}, result={"blob": "x" * 10_000}, ok=True)
    stored = store.audit_recent(1)[0].result
    assert stored["truncated"] is True and len(stored["preview"]) == 4000
    store.audit(
        user_id=None, tool="t", args={"when": datetime(2026, 1, 1)}, result=object(), ok=True
    )
    assert "2026-01-01" in store.audit_recent(1)[0].args["when"]


def test_audit_count_since_counts_only_successes(store):
    store.audit(user_id="u", tool="replace_media", args={}, result=None, ok=True)
    store.audit(user_id="u", tool="replace_media", args={}, result=None, ok=False)
    since = datetime.now(UTC) - timedelta(days=1)
    assert store.audit_count_since("replace_media", since) == 1
    assert store.audit_count_since("replace_media", datetime.now(UTC) + timedelta(minutes=1)) == 0


def test_user_upsert_and_lookup(store):
    assert store.get_user("d1") is None
    row = store.upsert_user("d1", email="a@b.c", raven_status="approved", seerr_user_id=4)
    assert row.seerr_user_id == 4 and row.email == "a@b.c" and row.tier_override is None
    assert row.raven_status == "approved" and row.is_owner is False
    assert store.upsert_user("d1", tier_override="trusted").tier_override == "trusted"
    with pytest.raises(ValueError, match="unknown user fields"):
        store.upsert_user("d1", nope=1)


def test_conversation_window_respects_token_budget(store):
    store.append_messages(
        "d1",
        [StoredMessage(Role.USER if i % 2 == 0 else Role.ASSISTANT, f"m{i}", 10) for i in range(5)],
    )
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
        action="replace_media",
        requester="d1",
        payload={"id": 5},
        summary="Replace Dune",
        ttl=timedelta(minutes=5),
    )
    assert p.decision is None and store.get_pending(p.id) == p
    decided = store.decide_pending(p.id, Decision.APPROVED, "d1")
    assert decided.decision is Decision.APPROVED
    assert store.decide_pending(p.id, Decision.DENIED, "d2") is None


def test_expired_pending_action_cannot_be_decided(store):
    p = store.create_pending(
        action="replace_media",
        requester="d1",
        payload={},
        summary="Replace Dune",
        ttl=timedelta(seconds=-1),
    )
    assert store.decide_pending(p.id, Decision.APPROVED, "d1") is None


def test_calls_inside_a_transaction_commit_or_roll_back_together(store):
    with store.transaction():
        store.upsert_user("d1", email="one@x")
        store.upsert_user("d2", email="two@x")
    assert store.get_user("d1") and store.get_user("d2")

    with pytest.raises(RuntimeError), store.transaction():
        store.upsert_user("d3", email="three@x")
        raise RuntimeError("boom")
    assert store.get_user("d3") is None
    store.upsert_user("d4")  # the store is usable again after a rollback
    assert store.get_user("d4")


def test_a_decision_records_who_and_can_be_reopened(store):
    p = store.create_pending(
        action="replace_media",
        requester="d1",
        payload={},
        summary="Replace Dune",
        ttl=timedelta(days=1),
    )
    assert store.decide_pending(p.id, Decision.APPROVED, "d1").decided_by == "d1"
    store.reopen_pending(p.id)
    reopened = store.get_pending(p.id)
    assert reopened.decision is None and reopened.decided_by is None


def test_claims_are_made_once_within_the_window(store):
    day = timedelta(days=1)
    assert store.claim("seerr", "MEDIA_AVAILABLE:request:77", window=day)
    assert not store.claim("seerr", "MEDIA_AVAILABLE:request:77", window=day)
    assert store.claim("seerr", "MEDIA_AVAILABLE:request:78", window=day)
    store.release("seerr", "MEDIA_AVAILABLE:request:77")
    assert store.claim("seerr", "MEDIA_AVAILABLE:request:77", window=day)
    # Once the window has passed (here: it already has), the same event counts as new,
    # and the stale claims are gone: request 78 is new again too.
    assert store.claim("seerr", "MEDIA_AVAILABLE:request:77", window=timedelta(seconds=-1))
    assert store.claim("seerr", "MEDIA_AVAILABLE:request:78", window=day)


def test_a_user_is_linked_once_matched_to_a_seerr_user(store):
    store.upsert_user("d1", tier_override="admin")  # an override-only row: no Seerr user
    assert store.active_link("d1") is None
    store.upsert_user("d1", seerr_user_id=4, email="dany@example.com")
    link = store.active_link("d1")
    assert (link.user_id, link.seerr_user_id, link.name) == ("d1", 4, "dany@example.com")
    assert store.active_link_by_seerr_id(4) == link
    store.upsert_user("d1", seerr_user_id=None)  # Seerr no longer lists them
    assert store.active_link("d1") is None and store.active_link_by_seerr_id(4) is None


def test_a_seerr_user_s_requests_belong_to_whoever_was_seen_last(store):
    store.upsert_user("d1", seerr_user_id=4, email="old@x", last_seen_at="2026-10-01Z")
    store.upsert_user("d2", seerr_user_id=4, email="new@x", last_seen_at="2026-10-08Z")
    assert store.active_link_by_seerr_id(4).user_id == "d2"


def test_each_source_prunes_only_its_own_claims(store):
    assert store.claim("reencode", "9001", window=timedelta(days=30))
    assert store.claim("seerr", "MEDIA_AVAILABLE:request:1", window=timedelta(minutes=15))
    # A Seerr claim whose window has passed is pruned without touching the re-encode flag.
    assert store.claim("seerr", "MEDIA_AVAILABLE:request:1", window=timedelta(seconds=-1))
    assert not store.claim("reencode", "9001", window=timedelta(days=30))
