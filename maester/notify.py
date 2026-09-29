"""Messages maester sends outside a reply, and the one interface that delivers them.

Tools, button decisions, webhooks and scheduled jobs all produce notices: a
post in the admin channel, the same with Approve/Deny buttons for one
pending action, an announcement in the requests channel for every friend,
a DM to one user, or a Discord role given or taken (an approved change of
access), which the bot makes and reports to the admin when it can't. Only the chat layer knows how to deliver them;
everything else hands them to a `Notifier`, which the Discord bot
implements, so `agent/`, `tools/` and `web/` never import Discord.

Delivery is best effort, one notice at a time: `deliver()` never raises,
and returns the notices it could not send so a caller that must know (the
webhook, which keeps a claim only for events it fully handled) can act.

A DM about a title carries it as `about`, so a reaction to the message (a
thumbs-down on "Dune is ready") can be traced back to what it was about.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from maester.media import Titled


@dataclass(frozen=True)
class AdminPost:
    text: str


@dataclass(frozen=True)
class ApprovalPost:
    """An admin-channel post whose Approve/Deny buttons settle one pending action."""

    text: str
    pending_id: int


@dataclass(frozen=True)
class Announcement:
    """A post in the requests channel, where every friend sees it (a maintenance window)."""

    text: str


@dataclass(frozen=True)
class DirectMessage:
    to: str  # a Discord user id
    text: str
    about: Titled | None = None


@dataclass(frozen=True)
class RoleChange:
    """A Discord role given to (or taken from) one member, by the bot."""

    to: str  # a Discord user id
    role_id: int
    add: bool = True
    why: str = ""  # for the server's audit log


Notice = AdminPost | ApprovalPost | Announcement | DirectMessage | RoleChange


class Notifier(Protocol):
    async def deliver(self, notices: Sequence[Notice]) -> list[Notice]:
        """Send each notice; never raises. Returns the ones that could not be sent."""
        ...
