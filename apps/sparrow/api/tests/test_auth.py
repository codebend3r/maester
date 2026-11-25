from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Annotated

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from sparrow.agent.tools import ToolRegistry
from sparrow.app import build
from sparrow.clients import FakeRavenClient
from sparrow.clients.raven import MemberStatus, RavenAccount
from sparrow.clients.seerr import SeerrUser
from sparrow.config import load_settings
from sparrow.web import create_app
from sparrow.web.api import Api
from sparrow.web.auth import AccountVerifier, Auth, SignInUnavailable, Viewer

NOW = datetime(2026, 10, 9, 12, 0, tzinfo=UTC)
APPROVED, PENDING, REVOKED = MemberStatus.APPROVED, MemberStatus.PENDING, MemberStatus.REVOKED

BOSS = RavenAccount("a-boss", "boss@example.com", APPROVED, True)  # raven's owner
DANY = RavenAccount("a-dany", "Dany@Example.com", APPROVED, False)
NEWBIE = RavenAccount("a-new", "new@example.com", PENDING, False)
GONE = RavenAccount("a-gone", "gone@example.com", REVOKED, False)


def bearer(token):
    return {"Authorization": f"Bearer {token}"} if token else {}


@pytest.fixture
def web(services, store):
    raven = services.raven
    raven.accounts = {"t-boss": BOSS, "t-dany": DANY, "t-new": NEWBIE, "t-gone": GONE}
    services.seerr.user_list = [SeerrUser(4, "dany@example.com", "Dany")]
    app = build(
        load_settings({}),
        services=services,
        model_client=object(),
        tools=ToolRegistry(),
        store=store,
    )
    auth = Auth(AccountVerifier(raven), app.chat.identity)
    web = create_app(api=Api(auth, app.chat.identity, app.store, raven))

    @web.get("/api/approved-only")
    async def approved_only(viewer: Annotated[Viewer, Depends(auth.approved)]) -> dict[str, str]:
        return {"tier": viewer.tier.name.lower(), "token": viewer.chat_user.raven_token or ""}

    client = TestClient(web)

    def get(path, token=None):
        return client.get(path, headers=bearer(token))

    return get, client, raven, store


def test_no_token_or_one_raven_refuses_is_signed_out(web):
    get, *_ = web
    for token in (None, "t-unknown"):
        r = get("/api/me", token)
        assert r.status_code == 401
        assert r.json() == {"reason": "signed_out"}
        assert r.headers["Cache-Control"] == "no-store"


def test_a_cookie_or_another_scheme_is_not_a_token(web):
    _, client, *_ = web
    assert client.get("/api/me", headers={"Authorization": "Basic t-dany"}).status_code == 401
    assert client.get("/api/me", cookies={"maester-auth": "t-dany"}).status_code == 401


def test_raven_down_with_nothing_cached_is_unavailable_not_signed_out(web):
    get, _, raven, _ = web
    raven.down = True
    r = get("/api/me", "t-dany")
    assert r.status_code == 503 and r.json() == {"reason": "sign_in_unavailable"}


def test_me_names_a_friend_and_records_who_they_are(web):
    get, _, _, store = web
    r = get("/api/me", "t-dany")
    assert r.status_code == 200 and r.headers["Cache-Control"] == "no-store"
    assert r.json() == {"user": {"id": "a-dany", "email": "Dany@Example.com"}, "tier": "friend"}
    user = store.get_user("a-dany")
    assert (user.email, user.raven_status, user.seerr_user_id) == (
        "dany@example.com",
        "approved",
        4,
    )
    assert user.last_seen_at


def test_raven_s_owner_is_admin(web):
    get, *_ = web
    assert get("/api/me", "t-boss").json()["tier"] == "admin"


def test_an_account_raven_has_not_approved_is_refused(web):
    get, *_ = web
    for token in ("t-new", "t-gone"):
        r = get("/api/approved-only", token)
        assert r.status_code == 403 and r.json() == {"reason": "not_approved"}
        assert get("/api/me", token).status_code == 403
    assert get("/api/approved-only", "t-dany").json() == {"tier": "friend", "token": "t-dany"}


def test_an_override_never_lets_an_unapproved_account_in(web):
    get, _, _, store = web
    get("/api/me", "t-new")
    store.upsert_user("a-new", tier_override="trusted")
    assert get("/api/approved-only", "t-new").status_code == 403


def test_the_sign_in_config_is_raven_s_relayed_as_it_is(web):
    get, _, raven, _ = web
    raven.config = {"state": "ready", "supabaseUrl": "https://x.supabase.co", "publishableKey": "k"}
    r = get("/api/auth/config")
    assert r.status_code == 200 and r.json() == raven.config
    raven.down = True
    r = get("/api/auth/config")
    assert r.status_code == 503 and r.json() == {"reason": "sign_in_unavailable"}


def set_tier(client, user_id, tier, token, **kwargs):
    return client.post(
        f"/api/admin/users/{user_id}/tier", json={"tier": tier}, headers=bearer(token), **kwargs
    )


def test_only_the_admin_sets_a_tier_and_it_counts_on_the_next_request(web):
    get, client, _, store = web
    get("/api/me", "t-dany")  # sparrow has seen them
    r = set_tier(client, "a-dany", "admin", "t-dany")
    assert r.status_code == 403 and r.json() == {"reason": "not_admin"}

    r = set_tier(client, "a-dany", "trusted", "t-boss")
    assert r.status_code == 200
    assert r.json() == {"user_id": "a-dany", "tier_override": "trusted", "tier": "trusted"}
    assert get("/api/me", "t-dany").json()["tier"] == "trusted"
    (audited,) = store.audit_recent(1)
    assert (audited.tool, audited.user_id, audited.args) == (
        "/tier",
        "a-boss",
        {"target": "a-dany", "tier": "trusted"},
    )

    r = set_tier(client, "a-dany", None, "t-boss")
    assert r.json() == {"user_id": "a-dany", "tier_override": None, "tier": "friend"}


def test_a_tier_change_takes_json_a_known_tier_and_a_known_user(web):
    get, client, *_ = web
    get("/api/me", "t-dany")
    r = client.post("/api/admin/users/a-dany/tier", content="tier=admin", headers=bearer("t-boss"))
    assert r.status_code == 415 and r.json() == {"reason": "json_only"}
    assert set_tier(client, "a-dany", "king", "t-boss").status_code == 422
    r = set_tier(client, "a-nobody", "trusted", "t-boss")
    assert r.status_code == 404 and r.json() == {"reason": "unknown_user"}


def test_build_mounts_the_api_behind_raven_s_sign_in(services, store):
    app = build(
        load_settings({}),
        services=services,
        model_client=object(),
        tools=ToolRegistry(),
        store=store,
    )
    r = TestClient(app.web).get("/api/me")
    assert r.status_code == 401 and r.json() == {"reason": "signed_out"}


async def test_an_answer_is_cached_for_thirty_seconds_by_the_token_s_hash():
    raven = FakeRavenClient(accounts={"t-dany": DANY})
    clock = SimpleNamespace(now=NOW)
    verifier = AccountVerifier(raven, clock=lambda: clock.now)
    assert await verifier.account("t-dany") == DANY
    clock.now += timedelta(seconds=29)
    raven.down = True  # a short outage goes unnoticed
    assert await verifier.account("t-dany") == DANY
    assert raven.asked == ["t-dany"] and "t-dany" not in verifier._cache
    clock.now += timedelta(seconds=1)
    with pytest.raises(SignInUnavailable):
        await verifier.account("t-dany")
    raven.down = False
    assert await verifier.account("t-dany") == DANY
    assert raven.asked == ["t-dany", "t-dany"]


async def test_a_token_raven_no_longer_accepts_is_not_cached():
    raven = FakeRavenClient(accounts={"t": DANY})
    clock = SimpleNamespace(now=NOW)
    verifier = AccountVerifier(raven, clock=lambda: clock.now)
    await verifier.account("t")
    del raven.accounts["t"]  # signed out, or expired
    clock.now += timedelta(seconds=30)
    assert await verifier.account("t") is None
    assert await verifier.account("t") is None
    assert raven.asked == ["t", "t", "t"]
