"""Reminders before a friend's access ends: a DM a week out, and again the day before.

Once a day, at the digest's time, Wizarr's users are read. A member has a
record per server, so their access ends at the earliest of their records'
expiries; each linked friend is matched by the email their link recorded. A reminder
goes out once the end is `EXPIRY_REMIND_DAYS` away or less (7, then 1, out
of the box), once each per expiry (claim source `expiry`, keyed by
friend, expiry and reminder), so a day the job missed is caught up rather
than skipped, only the nearest reminder is sent, and a renewal (a new
expiry) starts afresh. The text is `EXPIRY_REMINDER`, pointing at
`CONTRIBUTION_URL` when there is one.

Access that renews itself is always within a week of its end before it
renews (wizteros bills monthly for 35 days, renewing at day 30), so a
7-day reminder would reach every subscriber each month; there,
`EXPIRY_REMIND_DAYS=4,1` keeps the reminders for access that didn't renew.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta

from luwin.clients import ClientError, Services
from luwin.clients.wizarr import WizarrUser
from luwin.config import Settings
from luwin.notify import DirectMessage, Notice
from luwin.store import Store, UserRow

log = logging.getLogger("luwin.jobs")

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
    """When a friend's access ends: the earliest expiry of their Wizarr records, found by
    the email their link recorded (never a username, which a Seerr user may choose)."""
    email = (link.plex_email or "").lower()
    mine = [u for u in users if email and u.email == email]
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
        due = [r for r in settings.access.remind_days if 0 <= days <= r]
        if not due:
            continue
        nearest = min(due)
        key = f"{link.discord_id}:{end.isoformat()}:{nearest}"
        if store.claim(SOURCE, key, window=REMEMBERED):
            notices.append(DirectMessage(link.discord_id, reminder(settings, days, local)))
    return notices
