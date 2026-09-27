"""What maester does with each Seerr notification type.

`seerr_handlers()` is the dispatch table the webhook route serves, keyed by
Seerr's notification type. A handler reads what it needs from Seerr, Plex
and the store and returns the notices to send; delivering them, and making
sure one event is handled once, is the route's job. Today one type is
handled: MEDIA_AVAILABLE, a DM to the friend whose request is ready. Types
without a handler are acknowledged and ignored.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Sequence
from functools import partial

from maester.clients import ClientError, Services
from maester.clients.seerr import MediaRequest, SeerrNotification
from maester.notify import Notice
from maester.store import Store

log = logging.getLogger("maester.seerr")

SeerrHandler = Callable[[SeerrNotification], Awaitable[Sequence[Notice]]]


def seerr_handlers(services: Services, store: Store) -> dict[str, SeerrHandler]:
    return {"MEDIA_AVAILABLE": partial(ready_to_watch, services, store)}


def _what(notification: SeerrNotification, request: MediaRequest) -> str:
    seasons = request.seasons
    if not seasons:
        return notification.subject
    numbers = ", ".join(str(n) for n in seasons)
    return f"{notification.subject}, season{'s' if len(seasons) > 1 else ''} {numbers},"


async def ready_to_watch(
    services: Services, store: Store, notification: SeerrNotification
) -> list[Notice]:
    """DM the requester that their request can be watched: title, version, Plex link."""
    if notification.request_id is None:
        return []
    request = await services.seerr.get_request(notification.request_id)
    user = store.user_by_seerr_id(request.requested_by_id)
    if user is None:  # requested in Seerr by someone not linked here
        return []
    version = "4K" if request.is_4k else "1080p"
    link = await _plex_link(services, request)
    where = f"\nOpen it in Plex: {link}" if link else " Look for it in Plex."
    text = f"{_what(notification, request)} is ready to watch in {version}.{where}"
    return [Notice(text, to=user.discord_id)]


async def _plex_link(services: Services, request: MediaRequest) -> str | None:
    if request.rating_key is None:
        return None
    try:
        machine = await services.plex.machine_identifier()
    except ClientError as exc:  # the news matters more than the link
        log.warning("no Plex link for request %s: %s", request.id, exc)
        return None
    return services.plex.deep_link(machine, request.rating_key)
