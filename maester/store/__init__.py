"""SQLite persistence, one module per table, joined into one `Store`.

One file on `/data`, schema managed by numbered SQL migrations under
`migrations/`. Nothing here is a source of truth for media; Seerr and the
arrs are. This is the bot's own memory of who asked for what and what it did.

- `base.py`           the connection, transactions, migrations, timestamps
- `audit.py`          every tool call
- `users.py`          links to Plex/Seerr/Tautulli and tier overrides
- `conversations.py`  each user's conversation
- `pending.py`        confirmations and approvals waiting on a button
- `claims.py`         what's done once a window: webhook deliveries, re-encode flags
- `flags.py`          the kill switch and maintenance, kept across restarts
- `held.py`           calls held for a maintenance window
- `messages.py`       DMs about a title, for reactions
- `reports.py`        playback reports
- `stalls.py`         the stalled-download sweeper's queue watch and what it did
- `space.py`          free space per volume, a sample a day, for the forecast
"""

from maester.store.audit import AuditLog, AuditRow
from maester.store.base import MIGRATIONS_DIR, Database
from maester.store.claims import Claims
from maester.store.conversations import Conversations
from maester.store.flags import KILL, MAINTENANCE, Flag, Flags
from maester.store.held import HeldCall, HeldCalls
from maester.store.messages import SentMessages
from maester.store.pending import PendingAction, PendingActions
from maester.store.reports import ReportRow, Reports
from maester.store.space import SpaceSample, SpaceSamples
from maester.store.stalls import StallAction, StallRow, Stalls, Watched
from maester.store.users import (
    LinkedUser,
    LinkStatus,
    NotLinked,
    SeerrUserTaken,
    UserRow,
    Users,
)


class Store(
    AuditLog,
    Users,
    Conversations,
    PendingActions,
    Claims,
    Flags,
    HeldCalls,
    SentMessages,
    Reports,
    Stalls,
    SpaceSamples,
):
    """Every table's store over one connection."""


__all__ = [
    "KILL",
    "MAINTENANCE",
    "MIGRATIONS_DIR",
    "AuditRow",
    "Database",
    "Flag",
    "Flags",
    "HeldCall",
    "LinkStatus",
    "LinkedUser",
    "NotLinked",
    "PendingAction",
    "ReportRow",
    "SeerrUserTaken",
    "SpaceSample",
    "StallAction",
    "StallRow",
    "Store",
    "UserRow",
    "Watched",
]
