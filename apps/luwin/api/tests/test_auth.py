from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Annotated

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from luwin.agent.tools import ToolRegistry
from luwin.app import build
from luwin.clients import Account, FakeRookery
from luwin.clients.seerr import SeerrUser
from luwin.config import load_settings
from luwin.web import create_app
from luwin.web.api import Api
from luwin.web.auth import COOKIE, Auth, SessionVerifier, SignInUnavailable, Viewer

SIGN_IN = "https://rookery.test/login"
NOW = datetime(2026, 10, 9, 12, 0, tzinfo=UTC)


def account(user_id, plex_id, username, *, email="", expires_at=None):
    return Account(
        user_id=user_id,
        display_name=username,
        email=email,
        thumb=f"https://plex.tv/users/{plex_id}/avatar",
        plex_id=plex_id,
        plex_username=username,
        plex_email=email,
        expires_at=expires_at or datetime.now(UTC) + timedelta(days=30),
    )


BOSS = account("r-boss", "1", "boss", email="boss@example.com")  # owns the server
DANY = account("r-dany", "44", "dany_t", email="dany@example.com")
STRANGER = account("r-x", "99", "stranger", email="x@example.com")


@pytest.fixture
def web(services, store):
    rookery = FakeRookery(sessions={"t-boss": BOSS, "t-dany": DANY, "t-x": STRANGER})
    services.seerr.user_list = [SeerrUser(4, "dany@example.com", "Dany", "dany_t")]
    app = build(
        load_settings({}),
        services=services,
        model_client=object(),
        tools=ToolRegistry(),
        store=store,
        rookery=rookery,
    )
    auth = Auth(SessionVerifier(rookery), app.chat.identity, sign_in=SIGN_IN)
    web = create_app(api=Api(auth, app.console))

    @web.get("/api/linked-only")
    async def linked_only(viewer: Annotated[Viewer, Depends(auth.linked)]) -> dict[str, str]:
        return {"tier": viewer.tier.name.lower()}

    client = TestClient(web)

    def as_(token):
        client.cookies.clear()
        if token:
            client.cookies.set(COOKIE, token)
        return client

    return as_, rookery, store


def test_no_cookie_or_an_unknown_one_is_sent_to_sign_in(web):
    as_, *_ = web
    for token in (None, "t-unknown"):
        r = as_(token).get("/api/me")
        assert r.status_code == 401
        assert r.json() == {"reason": "signed_out", "sign_in": SIGN_IN}
        assert r.headers["Cache-Control"] == "no-store"


def test_an_expired_session_is_signed_out(web):
    as_, rookery, _ = web
    gone = datetime.now(UTC) - timedelta(days=1)
    rookery.sessions["t-old"] = account("r-old", "7", "old", expires_at=gone)
    assert as_("t-old").get("/api/me").status_code == 401


def test_rookery_down_with_nothing_cached_is_unavailable_not_signed_out(web):
    as_, rookery, _ = web
    rookery.down = True
    r = as_("t-dany").get("/api/me")
    assert r.status_code == 503 and r.json() == {"reason": "sign_in_unavailable"}


def test_me_names_a_friend_and_records_who_they_are(web):
    as_, _, store = web
    r = as_("t-dany").get("/api/me")
    assert r.status_code == 200 and r.headers["Cache-Control"] == "no-store"
    assert r.json() == {
        "user": {
            "id": "r-dany",
            "display_name": "dany_t",
            "thumb": "https://plex.tv/users/44/avatar",
        },
        "tier": "friend",
    }
    user = store.get_user("r-dany")
    assert (user.plex_id, user.seerr_user_id) == ("44", 4) and user.last_seen_at


def test_the_server_s_owner_is_admin(web):
    as_, *_ = web
    assert as_("t-boss").get("/api/me").json()["tier"] == "admin"


def test_a_stranger_is_signed_in_but_refused_with_whom_to_ask(web):
    as_, *_ = web
    assert as_("t-x").get("/api/me").json()["tier"] == "unlinked"
    r = as_("t-x").get("/api/linked-only")
    assert r.status_code == 403 and r.json() == {"reason": "unlinked", "admin": "boss"}
    assert as_("t-dany").get("/api/linked-only").json() == {"tier": "friend"}


def set_tier(client, user_id, tier, **kwargs):
    return client.post(f"/api/admin/users/{user_id}/tier", json={"tier": tier}, **kwargs)


def test_only_the_admin_sets_a_tier_and_it_counts_on_the_next_request(web):
    as_, _, store = web
    as_("t-dany").get("/api/me")  # luwin has seen them
    r = set_tier(as_("t-dany"), "r-dany", "admin")
    assert r.status_code == 403 and r.json() == {"reason": "not_admin"}

    r = set_tier(as_("t-boss"), "r-dany", "trusted")
    assert r.status_code == 200
    assert r.json() == {"user_id": "r-dany", "tier_override": "trusted", "tier": "trusted"}
    assert as_("t-dany").get("/api/me").json()["tier"] == "trusted"
    assert store.audit_recent(1)[0].tool == "/tier"

    r = set_tier(as_("t-boss"), "r-dany", None)
    assert r.json() == {"user_id": "r-dany", "tier_override": None, "tier": "friend"}


def test_a_tier_change_takes_json_a_known_tier_and_a_known_user(web):
    as_, *_ = web
    as_("t-dany").get("/api/me")
    boss = as_("t-boss")
    r = boss.post("/api/admin/users/r-dany/tier", content="tier=admin")
    assert r.status_code == 415 and r.json() == {"reason": "json_only"}
    assert set_tier(boss, "r-dany", "king").status_code == 422
    r = set_tier(boss, "r-nobody", "trusted")
    assert r.status_code == 404 and r.json() == {"reason": "unknown_user"}


def test_build_mounts_the_api_signing_in_at_rookery(services, store):
    cfg = load_settings({"ROOKERY_PUBLIC_URL": "https://rookery.maester.example.com/"})
    app = build(
        cfg,
        services=services,
        model_client=object(),
        tools=ToolRegistry(),
        store=store,
        rookery=FakeRookery(),
    )
    r = TestClient(app.web).get("/api/me")
    assert r.json() == {
        "reason": "signed_out",
        "sign_in": "https://rookery.maester.example.com/login",
    }


async def test_an_answer_is_cached_for_thirty_seconds_by_the_token_s_hash():
    rookery = FakeRookery(sessions={"t-dany": DANY})
    clock = SimpleNamespace(now=NOW)
    verifier = SessionVerifier(rookery, clock=lambda: clock.now)
    assert await verifier.account("t-dany") == DANY
    clock.now += timedelta(seconds=29)
    rookery.down = True  # a short outage goes unnoticed
    assert await verifier.account("t-dany") == DANY
    assert rookery.asked == ["t-dany"] and "t-dany" not in verifier._cache
    clock.now += timedelta(seconds=1)
    with pytest.raises(SignInUnavailable):
        await verifier.account("t-dany")
    rookery.down = False
    assert await verifier.account("t-dany") == DANY
    assert rookery.asked == ["t-dany", "t-dany"]


async def test_a_cached_session_that_expires_is_signed_out_at_once():
    soon = account("r-soon", "8", "soon", expires_at=NOW + timedelta(seconds=10))
    rookery = FakeRookery(sessions={"t": soon})
    clock = SimpleNamespace(now=NOW)
    verifier = SessionVerifier(rookery, clock=lambda: clock.now)
    assert await verifier.account("t") == soon
    clock.now += timedelta(seconds=10)
    assert await verifier.account("t") is None


async def test_a_session_rookery_no_longer_knows_is_not_cached():
    rookery = FakeRookery(sessions={"t": DANY})
    clock = SimpleNamespace(now=NOW)
    verifier = SessionVerifier(rookery, clock=lambda: clock.now)
    await verifier.account("t")
    del rookery.sessions["t"]  # signed out in rookery
    clock.now += timedelta(seconds=30)
    assert await verifier.account("t") is None
    assert await verifier.account("t") is None
    assert rookery.asked == ["t", "t", "t"]
