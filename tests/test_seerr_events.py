from maester.clients import ClientError
from maester.clients.seerr import MediaDetails, MediaRequest, MediaStatus, RequestStatus
from maester.media import Copy, Titled
from maester.notify import DirectMessage
from maester.seerr_events import RESCAN_REPEAT, SeerrNotification, ready_to_watch, seerr_routes


def notification(request_id="77", subject="Dune (2021)"):
    return SeerrNotification.from_webhook(
        {
            "notification_type": "MEDIA_AVAILABLE",
            "subject": subject,
            "media": {"media_type": "movie", "tmdbId": "438631", "tvdbId": ""},
            "request": {"request_id": request_id} if request_id else None,
        }
    )


def ready(services, **kw):
    base = dict(
        id=77, status=RequestStatus.APPROVED, media_type="movie", tmdb_id=438631, is_4k=False,
        requested_by_id=4, media_status=MediaStatus.AVAILABLE, rating_key="4348",
    )  # fmt: skip
    services.seerr.requests = [MediaRequest(**{**base, **kw})]


async def test_the_linked_requester_gets_title_version_and_plex_link(services, store):
    store.upsert_user("d1", status="active", seerr_user_id=4)
    ready(services, is_4k=True)
    (dm,) = await ready_to_watch(services, store, notification())
    assert dm.to == "d1" and dm.about == Titled(Copy("movie", 438631, True), "Dune (2021)")
    assert dm.text == (
        "Dune (2021) is ready to watch in 4K.\nOpen it in Plex: "
        "https://app.plex.tv/desktop/#!/server/fake-machine/details?key=%2Flibrary%2Fmetadata%2F4348"
    )


async def test_seasons_are_named_and_a_missing_link_is_said_plainly(services, store):
    store.upsert_user("d1", status="active", seerr_user_id=4)
    ready(services, media_type="tv", seasons=(2, 3), rating_key=None)
    (dm,) = await ready_to_watch(services, store, notification(subject="The Bear (2022)"))
    assert dm.text == (
        "The Bear (2022), seasons 2, 3, is ready to watch in 1080p. Look for it in Plex."
    )


async def test_plex_being_down_does_not_hold_back_the_news(services, store):
    store.upsert_user("d1", status="active", seerr_user_id=4)
    ready(services)

    async def down():
        raise ClientError("plex", "GET", "/identity", None, "timeout")

    services.plex.machine_identifier = down
    (dm,) = await ready_to_watch(services, store, notification())
    assert dm.text.endswith("Look for it in Plex.")


async def test_nobody_to_tell(services, store):
    ready(services)
    assert await ready_to_watch(services, store, notification()) == []  # not linked here
    store.upsert_user("d1", status="revoked", seerr_user_id=4)
    assert await ready_to_watch(services, store, notification()) == []
    assert await ready_to_watch(services, store, notification(request_id=None)) == []


def test_dispatch_table_and_event_keys(services, store):
    routes = seerr_routes(services, store)
    assert set(routes) == {
        "MEDIA_AVAILABLE", "MEDIA_PENDING", "MEDIA_APPROVED", "MEDIA_DECLINED",
        "ISSUE_RESOLVED", "ISSUE_REOPENED",
    }  # fmt: skip
    assert routes["MEDIA_AVAILABLE"].dedupe == RESCAN_REPEAT
    # The rest are idempotent (one approval per request, one decision per approval), so
    # every delivery acts.
    assert all(r.dedupe is None for t, r in routes.items() if t != "MEDIA_AVAILABLE")
    assert notification().event_key == "MEDIA_AVAILABLE:request:77"
    assert notification(request_id=None).event_key == "MEDIA_AVAILABLE:media:movie:438631"
    issue = SeerrNotification.from_webhook(
        {"notification_type": "ISSUE_RESOLVED", "issue": {"issue_id": "5"}, "media": None}
    )
    assert issue.event_key == "ISSUE_RESOLVED:issue:5"


def seerr_says(type_, request_id="77"):
    return SeerrNotification.from_webhook(
        {
            "notification_type": type_,
            "subject": "Dune (2021)",
            "media": {"media_type": "movie", "tmdbId": "438631"},
            "request": {"request_id": request_id},
        }
    )


def dune_pending(services, **kw):
    services.seerr.details[("movie", 438631)] = MediaDetails(
        438631, "movie", "Dune", 2021, "", MediaStatus.UNKNOWN, MediaStatus.PENDING
    )
    ready(services, status=RequestStatus.PENDING, media_status=MediaStatus.PENDING, **kw)


async def test_a_pending_request_asks_the_admin_once_however_often_seerr_says_so(services, store):
    store.upsert_user("d1", status="active", seerr_user_id=4, plex_username="dany")
    dune_pending(services, is_4k=True)
    routes = seerr_routes(services, store)
    (post,) = await routes["MEDIA_PENDING"].handle(seerr_says("MEDIA_PENDING"))
    assert post.text == "dany asks for Dune (2021) in 4K (Seerr request #77)."
    pending = store.get_pending(post.pending_id)
    assert pending.action == "decide_request" and pending.subject == "seerr-request:77"
    assert pending.payload == {
        "request_id": 77, "title": "Dune (2021)", "version": "4K", "requester": "d1"
    }  # fmt: skip
    assert await routes["MEDIA_PENDING"].handle(seerr_says("MEDIA_PENDING")) == []


async def test_a_pending_request_from_someone_not_linked_names_them_as_seerr_does(services, store):
    dune_pending(services, requested_by_name="Grandpa")
    (post,) = await seerr_routes(services, store)["MEDIA_PENDING"].handle(
        seerr_says("MEDIA_PENDING")
    )
    assert post.text.startswith("Grandpa asks for Dune (2021) in 1080p")
    assert store.get_pending(post.pending_id).payload["requester"] == ""


async def test_a_request_decided_before_the_webhook_lands_asks_nobody(services, store):
    ready(services)  # approved already
    assert (
        await seerr_routes(services, store)["MEDIA_PENDING"].handle(seerr_says("MEDIA_PENDING"))
        == []
    )


async def test_a_decision_made_in_seerr_closes_the_approval_here_and_tells_the_friend(
    services, store
):
    store.upsert_user("d1", status="active", seerr_user_id=4, plex_username="dany")
    dune_pending(services)
    routes = seerr_routes(services, store)
    (post,) = await routes["MEDIA_PENDING"].handle(seerr_says("MEDIA_PENDING"))
    (dm,) = await routes["MEDIA_DECLINED"].handle(seerr_says("MEDIA_DECLINED"))
    assert dm == DirectMessage("d1", "The admin declined Dune (2021) in 1080p.")
    closed = store.get_pending(post.pending_id)
    assert (closed.decision, closed.decided_by) == ("denied", "seerr")
    # Decided here first (a button), or never asked about: Seerr's echo does nothing.
    assert await routes["MEDIA_APPROVED"].handle(seerr_says("MEDIA_APPROVED")) == []
    assert await routes["MEDIA_APPROVED"].handle(seerr_says("MEDIA_APPROVED", "78")) == []
