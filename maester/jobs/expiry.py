"""Reminders before a friend's access ends: a DM a week out, and again the day before.

Once a day, at the digest's time, Wizarr's users are read. A member has a
record per server, so their access ends at the earliest of their records'
expiries; each linked friend is matched by the email or Plex username their
link recorded. A reminder goes out once the end is `REMINDERS` days away or
less (7, then 1), once each per expiry (claim source `expiry`, keyed by
friend, expiry and reminder), so a day the job missed is caught up rather
than skipped, only the nearest reminder is sent, and a renewal (a new
expiry) starts afresh. The text is `EXPIRY_REMINDER`, pointing at
`CONTRIBUTION_URL` when there is one.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

from maester.clients import ClientError, Services
from maester.clients.wizarr import WizarrUser
from maester.config import Settings
from maester.notify import DirectMessage, Notice
from maester.store import Store, UserRow

log = logging.getLogger("maester.jobs")

REMINDERS = (7, 1)  # days before the end
SOURCE = "expiry"
# Longer than any access period, so each reminder of one expiry goes out once.
REMEMBERED = timedelta(days=90)


def ends(user: WizarrUser) -> datetime | None:
    if not user.expires:
        return None
    try:
        when = datetime.fromisoformat(user.expires.replace("Z", "+00:00"))
    except ValueError:
        log.warning("Wizarr user %s has an unreadable expiry %r", user.id, user.expires)
        return None
    return when if when.tzinfo else when.replace(tzinfo=UTC)


def access_ends(link: UserRow, users: list[WizarrUser]) -> datetime | None:
    """When a friend's access ends: the earliest expiry of their Wizarr records."""
    email = (link.plex_email or "").lower()
    name = (link.plex_username or "").lower()
    mine = [
        u for u in users if (email and u.email == email) or (name and u.username.lower() == name)
    ]
    return min((e for e in map(ends, mine) if e is not None), default=None)


def when(days: int) -> str:
    return {0: "today", 1: "tomorrow"}.get(days, f"in {days} days")


def reminder(settings: Settings, days: int, end: date) -> str:
    access = settings.access
    renew = (
        f"To keep it going, chip in here: {access.contribution_url}"
        if access.contribution_url
        else "Ask the admin if you'd like to keep it going."
    )
    return access.reminder.format(when=when(days), date=f"{end:%a %b %d}", renew=renew).strip()


async def remind_expiring(
    services: Services,
    store: Store,
    settings: Settings,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> list[Notice]:
    try:
        users = await services.wizarr.list_users()
    except ClientError as exc:
        log.warning("no expiry reminders today: Wizarr didn't answer: %s", exc)
        return []
    zone = settings.jobs.zone
    today = now().astimezone(zone).date()
    notices: list[Notice] = []
    for link in store.active_users():
        end = access_ends(link, users)
        if end is None:
            continue
        local = end.astimezone(zone).date()
        days = (local - today).days
        due = [r for r in REMINDERS if 0 <= days <= r]
        if not due:
            continue
        nearest = min(due)
        key = f"{link.discord_id}:{end.isoformat()}:{nearest}"
        if store.claim(SOURCE, key, window=REMEMBERED):
            notices.append(DirectMessage(link.discord_id, reminder(settings, days, local)))
    return notices
