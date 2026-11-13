import pytest
from pydantic import ValidationError

from sparrow.clients import ClientError
from sparrow.clients.seerr import MediaRequest, MediaStatus, RequestStatus
from sparrow.media import Copy, Titled
from sparrow.notify import DirectMessage
from sparrow.seerr_events import RESCAN_REPEAT, SeerrNotification, ready_to_watch, seerr_routes


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
    store.upsert_user("d1", seerr_user_id=4)
    ready(services, is_4k=True)
    (dm,) = await ready_to_watch(services, store, notification())
    assert dm.to == "d1" and dm.about == Titled(Copy("movie", 438631, True), "Dune (2021)")
    assert dm.text == (
        "Dune (2021) is ready to watch in 4K.\nOpen it in Plex: "
        "https://app.plex.tv/desktop/#!/server/fake-machine/details?key=%2Flibrary%2Fmetadata%2F4348"
    )


async def test_seasons_are_named_and_a_missing_link_is_said_plainly(services, store):
    store.upsert_user("d1", seerr_user_id=4)
    ready(services, media_type="tv", seasons=(2, 3), rating_key=None)
    (dm,) = await ready_to_watch(services, store, notification(subject="The Bear (2022)"))
    assert dm.text == (
        "The Bear (2022), seasons 2, 3, is ready to watch in 1080p. Look for it in Plex."
    )


async def test_plex_being_down_does_not_hold_back_the_news(services, store):
    store.upsert_user("d1", seerr_user_id=4)
    ready(services)

    async def down():
        raise ClientError("plex", "GET", "/identity", None, "timeout")

    services.plex.machine_identifier = down
    (dm,) = await ready_to_watch(services, store, notification())
    assert dm.text.endswith("Look for it in Plex.")


async def test_nobody_to_tell(services, store):
    ready(services)
    assert await ready_to_watch(services, store, notification()) == []  # not linked here
    store.upsert_user("d1", plex_username="dany")  # signed in, but matched to no Seerr user
    assert await ready_to_watch(services, store, notification()) == []
    assert await ready_to_watch(services, store, notification(request_id=None)) == []


def test_dispatch_table_and_event_keys(services, store):
    routes = seerr_routes(services, store)
    assert set(routes) == {
        "MEDIA_AVAILABLE", "MEDIA_APPROVED", "MEDIA_DECLINED", "ISSUE_RESOLVED", "ISSUE_REOPENED",
    }  # fmt: skip
    # The DM-sending events dedupe a rescan's repeat; the issue updates are idempotent.
    dm_events = {"MEDIA_AVAILABLE", "MEDIA_APPROVED", "MEDIA_DECLINED"}
    assert all(routes[t].dedupe == RESCAN_REPEAT for t in dm_events)
    assert all(r.dedupe is None for t, r in routes.items() if t not in dm_events)
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


async def test_a_decision_made_in_seerr_tells_the_linked_friend(services, store):
    store.upsert_user("d1", seerr_user_id=4, plex_username="dany")
    ready(services, status=RequestStatus.DECLINED)
    routes = seerr_routes(services, store)
    (dm,) = await routes["MEDIA_DECLINED"].handle(seerr_says("MEDIA_DECLINED"))
    assert dm == DirectMessage("d1", "The admin declined Dune (2021) in 1080p.")
    ready(services, is_4k=True)
    (dm,) = await routes["MEDIA_APPROVED"].handle(seerr_says("MEDIA_APPROVED"))
    assert dm.text.startswith("The admin approved Dune (2021) in 4K.")


async def test_a_decision_for_someone_not_linked_here_tells_nobody(services, store):
    ready(services)
    routes = seerr_routes(services, store)
    assert await routes["MEDIA_APPROVED"].handle(seerr_says("MEDIA_APPROVED")) == []
    assert await routes["MEDIA_APPROVED"].handle(seerr_says("MEDIA_APPROVED", "")) == []


def test_a_payload_that_isnt_a_seerr_notification_is_refused():
    with pytest.raises(ValidationError):
        SeerrNotification.from_webhook({"subject": "no type"})
    loose = SeerrNotification.from_webhook(
        {"notification_type": "TEST", "subject": None, "media": None, "extra": [], "image": ""}
    )
    assert (loose.subject, loose.tmdb_id, loose.request_id) == ("", None, None)
