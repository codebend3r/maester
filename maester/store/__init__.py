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
- `messages.py`       DMs about a title, for reactions
- `reports.py`        playback reports
"""

from maester.store.audit import AuditLog, AuditRow
from maester.store.base import MIGRATIONS_DIR, Database
from maester.store.claims import Claims
from maester.store.conversations import Conversations
from maester.store.flags import KILL, MAINTENANCE, Flag, Flags
from maester.store.messages import SentMessages
from maester.store.pending import PendingAction, PendingActions
from maester.store.reports import ReportRow, Reports
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
    SentMessages,
    Reports,
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
    "LinkStatus",
    "LinkedUser",
    "NotLinked",
    "PendingAction",
    "ReportRow",
    "SeerrUserTaken",
    "Store",
    "UserRow",
]
