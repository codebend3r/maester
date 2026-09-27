from maester.clients import ClientError
from maester.clients.seerr import MediaRequest, MediaStatus, RequestStatus
from maester.seerr_events import SeerrNotification, ready_to_watch, seerr_handlers


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
    assert dm.to == "d1"
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
    assert set(seerr_handlers(services, store)) == {"MEDIA_AVAILABLE"}
    assert notification().event_key == "MEDIA_AVAILABLE:request:77"
    assert notification(request_id=None).event_key == "MEDIA_AVAILABLE:media:movie:438631"
    issue = SeerrNotification.from_webhook(
        {"notification_type": "ISSUE_RESOLVED", "issue": {"issue_id": "5"}, "media": None}
    )
    assert issue.event_key == "ISSUE_RESOLVED:issue:5"
