import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

from luwin.store import SeerrUserTaken, Store
from luwin.store.base import APPLICATION_ID, OldDatabase, stamp


def test_migrations_apply_once(store):
    assert store.migrate() == []
    tables = {
        r[0]
        for r in store._conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert {"users", "conversations", "audit_log", "reports", "pending_actions"} <= tables


def test_a_new_database_is_luwins_and_keyed_by_user_id(tmp_path):
    store = Store(tmp_path / "luwin.db")
    assert store._conn.execute("PRAGMA application_id").fetchone()[0] == APPLICATION_ID
    for table in ("users", "conversations", "audit_log", "reports", "held_calls"):
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
    with pytest.raises(OldDatabase, match="before luwin's fresh start"):
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
    # Asked for an approval rather than acting: not a replacement.
    store.audit(user_id="u", tool="replace_media", args={}, result=None, ok=True, pending_id=3)
    since = datetime.now(UTC) - timedelta(days=1)
    assert store.audit_count_since("replace_media", since) == 1
    assert store.audit_recent(1)[0].pending_id == 3
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


def test_user_by_seerr_id_finds_the_live_link(store):
    store.upsert_user("d1", seerr_user_id=4, status="pending")
    assert store.user_by_seerr_id(4).status == "pending"
    store.upsert_user("d1", status="active")
    assert store.user_by_seerr_id(4).user_id == "d1"
    store.upsert_user("d1", status="revoked")
    assert store.user_by_seerr_id(4) is None and store.user_by_seerr_id(5) is None


def test_an_active_link_is_approved_and_names_a_seerr_user(store):
    store.upsert_user("d1", status="active")  # an override-only row: no Seerr user
    assert store.active_link("d1") is None
    store.upsert_user("d1", seerr_user_id=4, plex_username="dany", tautulli_user_id=9)
    link = store.active_link("d1")
    assert (link.user_id, link.seerr_user_id, link.tautulli_user_id, link.name) == (
        "d1",
        4,
        9,
        "dany",
    )
    assert store.active_link_by_seerr_id(4) == link
    store.upsert_user("d1", status="pending")
    assert store.active_link("d1") is None and store.active_link_by_seerr_id(4) is None


def test_a_seerr_user_has_one_live_link(store):
    store.upsert_user("d1", seerr_user_id=4, status="active")
    with pytest.raises(SeerrUserTaken):
        store.upsert_user("d2", seerr_user_id=4, status="pending")
    store.upsert_user("d1", status="revoked")
    assert store.upsert_user("d2", seerr_user_id=4, status="pending").seerr_user_id == 4


def test_each_source_prunes_only_its_own_claims(store):
    assert store.claim("reencode", "9001", window=timedelta(days=30))
    assert store.claim("seerr", "MEDIA_AVAILABLE:request:1", window=timedelta(minutes=15))
    # A Seerr claim whose window has passed is pruned without touching the re-encode flag.
    assert store.claim("seerr", "MEDIA_AVAILABLE:request:1", window=timedelta(seconds=-1))
    assert not store.claim("reencode", "9001", window=timedelta(days=30))


def test_a_flag_is_up_until_lowered_and_raising_it_again_replaces_its_message(store):
    assert store.flag("maintenance") is None
    first = store.raise_flag("maintenance", "swapping a drive", "a1")
    store.raise_flag("maintenance", "swapping two drives", "a1")
    flag = store.flag("maintenance")
    assert (flag.message, flag.set_by) == ("swapping two drives", "a1")
    assert flag.set_at == first.set_at  # still up since the first time
    assert store.lower_flag("maintenance") == flag
    assert store.flag("maintenance") is None and store.lower_flag("maintenance") is None


def raise_about(store, subject, **kw):
    fields = dict(kind="approve", action="decide_request", requester="d1", payload={"n": 1})
    return store.create_pending_once(
        subject=subject, summary="4K Dune", ttl=timedelta(days=7), **{**fields, **kw}
    )


def test_one_open_approval_per_subject_and_the_second_raiser_gets_it_back(store):
    first, new = raise_about(store, "seerr-request:7")
    again, fresh = raise_about(store, "seerr-request:7", requester="webhook")
    assert new and not fresh and again.id == first.id and again.requester == "d1"
    assert store.pending_about("seerr-request:7") == first
    other, new_other = raise_about(store, "seerr-request:8")
    assert new_other and other.id != first.id
    store.decide_pending(first.id, "approved", "a1")
    assert store.pending_about("seerr-request:7") is None
    later, new_later = raise_about(store, "seerr-request:7")
    assert new_later and later.id != first.id
    # The first press failed meanwhile: it can't reopen over the newer approval.
    assert not store.reopen_pending(first.id)
    assert store.get_pending(first.id).decision == "approved"


def test_an_expired_approval_frees_its_subject(store):
    stale, _ = raise_about(store, "seerr-request:9")
    store._conn.execute(
        "UPDATE pending_actions SET expires_at = ? WHERE id = ?",
        (stamp(datetime.now(UTC) - timedelta(seconds=1)), stale.id),
    )
    fresh, new = raise_about(store, "seerr-request:9")
    assert new and fresh.id != stale.id
    assert store.get_pending(stale.id).decision == "expired"
