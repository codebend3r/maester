"""Messages luwin sends outside a reply, and the one interface that delivers them.

Tools, decisions, webhooks and scheduled jobs all produce notices: a note for
the admin, the same with Approve/Deny choices for one pending action, an
announcement every friend sees, or a direct message to one user. Everything
hands them to a `Notifier`, so `agent/`, `tools/` and `web/` never know how a
notice reaches anyone. Until luwin's own app delivers them, `LogNotifier`
writes them to the log.

Delivery is best effort, one notice at a time: `deliver()` never raises,
and returns the notices it could not send so a caller that must know (the
webhook, which keeps a claim only for events it fully handled) can act.

A direct message about a title carries it as `about`, so the app can offer a
way to report a problem with that copy from the message itself.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from luwin.media import Titled


@dataclass(frozen=True)
class AdminPost:
    text: str


@dataclass(frozen=True)
class ApprovalPost:
    """A note for the admin whose Approve/Deny choices settle one pending action."""

    text: str
    pending_id: int


@dataclass(frozen=True)
class Announcement:
    """A notice every friend sees (a maintenance window)."""

    text: str


@dataclass(frozen=True)
class DirectMessage:
    to: str  # a user id
    text: str
    about: Titled | None = None


Notice = AdminPost | ApprovalPost | Announcement | DirectMessage


class Notifier(Protocol):
    async def deliver(self, notices: Sequence[Notice]) -> list[Notice]:
        """Send each notice; never raises. Returns the ones that could not be sent."""
        ...


log = logging.getLogger("luwin.notify")


class LogNotifier:
    """Writes each notice to the log, until luwin's own app delivers them.

    Every notice counts as delivered, so the webhook settles its claims and
    nothing is retried for want of a reader.
    """

    async def deliver(self, notices: Sequence[Notice]) -> list[Notice]:
        for notice in notices:
            log.info("notice: %s", notice)
        return []
