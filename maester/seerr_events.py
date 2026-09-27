"""What maester does with each Seerr notification type.

`seerr_routes()` is the dispatch table the webhook serves, keyed by Seerr's
notification type. A handler reads what it needs from Seerr, Plex and the
store and returns the notices to send; delivering them is the webhook's
job. A route opts into deduplication when a repeat would reach a person
twice: Seerr can send the same event again within minutes (a library
rescan), while a later repeat is news (a replaced file ready again) and
must get through. MEDIA_AVAILABLE DMs the friend whose request is ready;
ISSUE_RESOLVED and ISSUE_REOPENED follow a playback report's issue into
its report row, idempotently, and tell the reporter once when theirs is
resolved. Types without a route are ignored.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import timedelta
from functools import partial
from typing import Any

from maester.clients import ClientError, Services
from maester.clients.seerr import MediaRequest
from maester.notify import DirectMessage, MediaRef, Notice
from maester.store import Store

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
# A repeat of a DM-sending event inside this window is Seerr sending it twice.
RESCAN_REPEAT = timedelta(minutes=15)


@dataclass(frozen=True)
class SeerrRoute:
    handle: SeerrHandler
    # Deliveries of one event (type plus request or issue) within this window
    # act once; None when every delivery should act (idempotent updates).
    dedupe: timedelta | None = None


def seerr_routes(services: Services, store: Store) -> dict[str, SeerrRoute]:
    return {
        "MEDIA_AVAILABLE": SeerrRoute(partial(ready_to_watch, services, store), RESCAN_REPEAT),
        # Only a change of state acts, so a repeated delivery does nothing twice.
        "ISSUE_RESOLVED": SeerrRoute(partial(issue_status, store, True)),
        "ISSUE_REOPENED": SeerrRoute(partial(issue_status, store, False)),
    }


async def issue_status(
    store: Store, resolved: bool, notification: SeerrNotification
) -> list[Notice]:
    """Mark the reports behind a Seerr issue resolved (or open again); tell each reporter
    once when theirs is resolved."""
    if notification.issue_id is None:
        return []
    changed = store.set_issue_resolved(notification.issue_id, resolved)
    if not resolved:
        return []
    return [
        DirectMessage(r.discord_id, f"Your report about {r.title} in {r.version} was resolved.")
        for r in changed
    ]


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
    user = store.active_link_by_seerr_id(request.requested_by_id)
    if user is None:  # requested in Seerr by someone not linked here
        return []
    version = "4K" if request.is_4k else "1080p"
    link = await _plex_link(services, request)
    where = f"\nOpen it in Plex: {link}" if link else " Look for it in Plex."
    text = f"{_what(notification, request)} is ready to watch in {version}.{where}"
    about = MediaRef(request.media_type, request.tmdb_id, request.is_4k, notification.subject)
    return [DirectMessage(user.discord_id, text, about)]


async def _plex_link(services: Services, request: MediaRequest) -> str | None:
    if request.rating_key is None:
        return None
    try:
        machine = await services.plex.machine_identifier()
    except ClientError as exc:  # the news matters more than the link
        log.warning("no Plex link for request %s: %s", request.id, exc)
        return None
    return services.plex.deep_link(machine, request.rating_key)
