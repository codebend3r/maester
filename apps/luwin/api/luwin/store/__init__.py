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

from luwin.store.audit import AuditLog, AuditRow
from luwin.store.base import MIGRATIONS_DIR, Database
from luwin.store.claims import Claims
from luwin.store.conversations import Conversations
from luwin.store.flags import KILL, MAINTENANCE, Flag, Flags
from luwin.store.held import HeldCall, HeldCalls
from luwin.store.messages import SentMessages
from luwin.store.pending import PendingAction, PendingActions
from luwin.store.reports import ReportRow, Reports
from luwin.store.space import SpaceSample, SpaceSamples
from luwin.store.stalls import StallAction, StallRow, Stalls, Watched
from luwin.store.users import (
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
