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
from dataclasses import dataclass
from functools import partial
from typing import Any

from maester.clients import ClientError, Services
from maester.clients.seerr import MediaRequest
from maester.notify import Notice
from maester.store import LinkStatus, Store

log = logging.getLogger("maester.seerr")


def _int_or_none(value: Any) -> int | None:
    return int(value) if value not in (None, "") else None


@dataclass(frozen=True)
class SeerrNotification:
    """One webhook delivery, read from Seerr's default JSON payload template.

    The template renders every value as a string and leaves the `media`,
    `request` and `issue` blocks null when the event has none.
    """

    type: str  # notification_type, e.g. "MEDIA_AVAILABLE"
    subject: str  # for media events, "<title> (<year>)"
    media_type: str | None
    tmdb_id: int | None
    request_id: int | None
    issue_id: int | None

    @property
    def event_key(self) -> str:
        """What makes two deliveries the same event: the type and what it concerns."""
        if self.request_id is not None:
            about = f"request:{self.request_id}"
        elif self.issue_id is not None:
            about = f"issue:{self.issue_id}"
        else:
            about = f"media:{self.media_type}:{self.tmdb_id}"
        return f"{self.type}:{about}"

    @classmethod
    def from_webhook(cls, raw: dict[str, Any]) -> SeerrNotification:
        media = raw.get("media") or {}
        request = raw.get("request") or {}
        issue = raw.get("issue") or {}
        return cls(
            type=str(raw["notification_type"]),
            subject=raw.get("subject") or "",
            media_type=media.get("media_type") or None,
            tmdb_id=_int_or_none(media.get("tmdbId")),
            request_id=_int_or_none(request.get("request_id")),
            issue_id=_int_or_none(issue.get("issue_id")),
        )


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
    if user is None or user.status != LinkStatus.ACTIVE:  # not linked here (yet)
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
