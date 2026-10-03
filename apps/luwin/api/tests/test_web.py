from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from luwin import __version__
from luwin.notify import DirectMessage
from luwin.seerr_events import SeerrRoute
from luwin.web import create_app
from luwin.web.seerr import SeerrWebhook

SECRET = "s3cret"


class Outbox:
    def __init__(self, fails_for=()):
        self.sent = []
        self.fails_for = set(fails_for)

    async def deliver(self, notices):
        failed = [n for n in notices if n.to in self.fails_for]
        self.sent.extend(n for n in notices if n not in failed)
        return failed


@pytest.fixture
def hook(store):
    seen = []

    async def ready(notification):
        if notification.request_id == 13:
            raise RuntimeError("seerr down")
        seen.append(notification)
        to = "closed-dms" if notification.request_id == 99 else "d1"
        return [DirectMessage(to, f"{notification.subject} is ready")]

    async def resolved(notification):
        seen.append(notification)
        return []

    outbox = Outbox(fails_for={"closed-dms"})
    routes = {
        "MEDIA_AVAILABLE": SeerrRoute(ready, dedupe=timedelta(minutes=15)),
        "ISSUE_RESOLVED": SeerrRoute(resolved),
    }
    webhook = SeerrWebhook(SECRET, routes, store, outbox)
    return TestClient(create_app(seerr=webhook), raise_server_exceptions=False), seen, outbox


def post(client, payload, secret=SECRET):
    return client.post("/webhooks/seerr", json=payload, headers={"Authorization": secret})


def test_health_is_open_and_reports_version(hook):
    client, *_ = hook
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "version": __version__}


def test_an_event_is_handled_once_and_its_notices_delivered(hook, fixture):
    client, seen, outbox = hook
    payload = fixture("seerr_webhook_available")
    assert post(client, payload).json() == {"status": "handled"}
    assert post(client, payload).json() == {"status": "duplicate"}
    (notification,) = seen
    assert notification.type == "MEDIA_AVAILABLE" and notification.request_id == 77
    assert notification.tmdb_id == 438631 and notification.media_type == "movie"
    assert outbox.sent == [DirectMessage("d1", "Dune (2021) is ready")]
    other = {**payload, "request": {**payload["request"], "request_id": "78"}}
    assert post(client, other).json() == {"status": "handled"}


def test_the_secret_is_required(hook, fixture, store):
    client, seen, _ = hook
    assert post(client, fixture("seerr_webhook_available"), secret="wrong").status_code == 401
    assert client.post("/webhooks/seerr", json={}).status_code == 401
    assert seen == []

    open_hook = SeerrWebhook("", {}, store, Outbox())
    unset = TestClient(create_app(seerr=open_hook))
    assert post(unset, fixture("seerr_webhook_available"), secret="").status_code == 401


def test_types_without_a_handler_are_ignored(hook):
    client, seen, _ = hook
    test = {"notification_type": "TEST_NOTIFICATION", "subject": "Test", "media": None}
    assert post(client, test).json() == {"status": "ignored"}
    assert post(client, {"subject": "no type"}).status_code == 422
    assert seen == []


def test_a_failed_handler_releases_its_claim(hook, fixture):
    client, _, outbox = hook
    payload = fixture("seerr_webhook_available")
    failing = {**payload, "request": {**payload["request"], "request_id": "13"}}
    assert post(client, failing).status_code == 500
    assert post(client, failing).status_code == 500  # retried, not swallowed as a duplicate
    assert outbox.sent == []


def test_routes_without_dedupe_act_on_every_delivery(hook):
    client, seen, _ = hook
    resolved = {"notification_type": "ISSUE_RESOLVED", "issue": {"issue_id": "5"}, "media": None}
    assert post(client, resolved).json() == {"status": "handled"}
    assert post(client, resolved).json() == {"status": "handled"}
    assert len(seen) == 2


def test_an_undelivered_notice_releases_the_claim(hook, fixture):
    client, seen, outbox = hook
    payload = fixture("seerr_webhook_available")
    closed = {**payload, "request": {**payload["request"], "request_id": "99"}}
    assert post(client, closed).json() == {"status": "undelivered"}
    assert post(client, closed).json() == {"status": "undelivered"}  # not a duplicate
    assert len(seen) == 2 and outbox.sent == []
