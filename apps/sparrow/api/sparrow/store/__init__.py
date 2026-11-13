"""SQLite persistence, one module per table, joined into one `Store`.

One file on `/data`, schema managed by numbered SQL migrations under
`migrations/`. Nothing here is a source of truth for media; Seerr and the
arrs are. This is sparrow's own memory of who asked for what and what it did.

- `base.py`           the connection, transactions, migrations, timestamps
- `audit.py`          every tool call
- `users.py`          who a signed-in user is on Plex/Seerr/Tautulli, and tier overrides
- `conversations.py`  each user's conversation
- `pending.py`        confirmations waiting on a button
- `claims.py`         what's done once a window: webhook deliveries, re-encode flags
- `reports.py`        playback reports
- `stalls.py`         the stalled-download sweeper's queue watch and what it did
- `space.py`          free space per volume, a sample a day, for the forecast
"""

from sparrow.store.audit import AuditLog, AuditRow
from sparrow.store.base import MIGRATIONS_DIR, Database
from sparrow.store.claims import Claims
from sparrow.store.conversations import Conversations
from sparrow.store.pending import Decision, PendingAction, PendingActions
from sparrow.store.reports import ReportRow, Reports
from sparrow.store.space import SpaceSample, SpaceSamples
from sparrow.store.stalls import StallAction, StallRow, Stalls, Watched
from sparrow.store.users import LinkedUser, NotLinked, UserRow, Users


class Store(
    AuditLog,
    Users,
    Conversations,
    PendingActions,
    Claims,
    Reports,
    Stalls,
    SpaceSamples,
):
    """Every table's store over one connection."""


__all__ = [
    "MIGRATIONS_DIR",
    "AuditRow",
    "Database",
    "Decision",
    "LinkedUser",
    "NotLinked",
    "PendingAction",
    "ReportRow",
    "SpaceSample",
    "StallAction",
    "StallRow",
    "Store",
    "UserRow",
    "Watched",
]
