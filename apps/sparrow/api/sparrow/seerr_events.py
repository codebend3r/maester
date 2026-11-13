"""What sparrow does with each Seerr notification type.

`seerr_routes()` is the dispatch table the webhook serves, keyed by Seerr's
notification type. A handler reads what it needs from Seerr, Plex and the
store and returns the notices to send; delivering them is the webhook's
job. A route opts into deduplication when a repeat would reach a person
twice: Seerr can send the same event again within minutes (a library
rescan), while a later repeat is news (a replaced file ready again) and
must get through. MEDIA_AVAILABLE DMs the friend whose request is ready;
MEDIA_APPROVED and MEDIA_DECLINED tell them the admin's decision in Seerr;
ISSUE_RESOLVED and ISSUE_REOPENED follow a playback report's issue into
its report row, idempotently, and tell the reporter once when theirs is
resolved. Types without a route are ignored.

The payload is Seerr's default JSON template, checked at the boundary
(`SeerrPayload`): the template renders every value as a string and leaves
the `media`, `request` and `issue` blocks null when the event has none.
Fields sparrow doesn't read are ignored rather than refused, since Seerr's
template carries more than this reads and an admin may extend it.
"""

from __future__ import annotations

import enum
import logging
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import timedelta
from functools import partial
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from sparrow.clients import ClientError, Services
from sparrow.clients.seerr import MediaRequest, int_or_none
from sparrow.media import Copy, Titled, version_label
from sparrow.notify import DirectMessage, Notice
from sparrow.store import Store

log = logging.getLogger("sparrow.seerr")


class NotificationType(enum.StrEnum):
    """The Seerr notification types sparrow acts on."""

    MEDIA_AVAILABLE = "MEDIA_AVAILABLE"
    MEDIA_APPROVED = "MEDIA_APPROVED"
    MEDIA_DECLINED = "MEDIA_DECLINED"
    ISSUE_RESOLVED = "ISSUE_RESOLVED"
    ISSUE_REOPENED = "ISSUE_REOPENED"


_BLOCK = ConfigDict(extra="ignore", frozen=True)
# An id the template may leave out or render as "".
SeerrId = Annotated[int | None, BeforeValidator(int_or_none)]


class _Media(BaseModel):
    model_config = _BLOCK
    media_type: str | None = None
    tmdb_id: SeerrId = Field(None, alias="tmdbId")


class _Request(BaseModel):
    model_config = _BLOCK
    request_id: SeerrId = None


class _Issue(BaseModel):
    model_config = _BLOCK
    issue_id: SeerrId = None


class SeerrPayload(BaseModel):
    """What the webhook reads of Seerr's default JSON template."""

    model_config = _BLOCK
    notification_type: str
    subject: Annotated[str, BeforeValidator(lambda value: value or "")] = ""
    media: _Media | None = None
    request: _Request | None = None
    issue: _Issue | None = None


@dataclass(frozen=True)
class SeerrNotification:
    """One webhook delivery, as the handlers read it."""

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
    def of(cls, payload: SeerrPayload) -> SeerrNotification:
        media = payload.media or _Media()
        return cls(
            type=payload.notification_type,
            subject=payload.subject,
            media_type=media.media_type or None,
            tmdb_id=media.tmdb_id,
            request_id=payload.request.request_id if payload.request else None,
            issue_id=payload.issue.issue_id if payload.issue else None,
        )

    @classmethod
    def from_webhook(cls, raw: object) -> SeerrNotification:
        """`pydantic.ValidationError` when `raw` isn't a Seerr notification."""
        return cls.of(SeerrPayload.model_validate(raw))


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
        NotificationType.MEDIA_AVAILABLE: SeerrRoute(
            partial(ready_to_watch, services, store), RESCAN_REPEAT
        ),
        NotificationType.MEDIA_APPROVED: SeerrRoute(
            partial(decided_in_seerr, services, store, True), RESCAN_REPEAT
        ),
        NotificationType.MEDIA_DECLINED: SeerrRoute(
            partial(decided_in_seerr, services, store, False), RESCAN_REPEAT
        ),
        # Only a change of state acts, so a repeated delivery does nothing twice.
        NotificationType.ISSUE_RESOLVED: SeerrRoute(partial(issue_status, store, True)),
        NotificationType.ISSUE_REOPENED: SeerrRoute(partial(issue_status, store, False)),
    }


def decision_dm(title: str, version: str, approved: bool) -> str:
    """What the requester is told once the admin decides their request in Seerr."""
    if approved:
        return (
            f"The admin approved {title} in {version}. It's on its way; I'll message you when "
            "it's ready."
        )
    if version == "4K":
        return f"The admin declined {title} in 4K. You can still ask for the regular version."
    return f"The admin declined {title} in {version}."


async def decided_in_seerr(
    services: Services, store: Store, approved: bool, notification: SeerrNotification
) -> list[Notice]:
    """The admin decided a request in Seerr: tell the friend who asked, when linked here."""
    if notification.request_id is None:
        return []
    request = await services.seerr.get_request(notification.request_id)
    user = store.active_link_by_seerr_id(request.requested_by_id)
    if user is None:
        return []
    text = decision_dm(notification.subject, version_label(request.is_4k), approved)
    return [DirectMessage(user.user_id, text)]


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
        DirectMessage(r.user_id, f"Your report about {r.title} in {r.copy.version} was resolved.")
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
    version = version_label(request.is_4k)
    link = await _plex_link(services, request)
    where = f"\nOpen it in Plex: {link}" if link else " Look for it in Plex."
    text = f"{_what(notification, request)} is ready to watch in {version}.{where}"
    about = Titled(Copy(request.media_type, request.tmdb_id, request.is_4k), notification.subject)
    return [DirectMessage(user.user_id, text, about)]


async def _plex_link(services: Services, request: MediaRequest) -> str | None:
    if request.rating_key is None:
        return None
    try:
        machine = await services.plex.machine_identifier()
    except ClientError as exc:  # the news matters more than the link
        log.warning("no Plex link for request %s: %s", request.id, exc)
        return None
    return services.plex.deep_link(machine, request.rating_key)
