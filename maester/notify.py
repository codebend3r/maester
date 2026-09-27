"""Messages maester sends outside a reply, and the one interface that delivers them.

Tools, button decisions and webhooks all produce notices: a post in the
admin channel, the same with Approve/Deny buttons for one pending action,
or a DM to one user. Only the chat layer knows how to deliver them;
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


@dataclass(frozen=True)
class AdminPost:
    text: str


@dataclass(frozen=True)
class ApprovalPost:
    """An admin-channel post whose Approve/Deny buttons settle one pending action."""

    text: str
    pending_id: int


@dataclass(frozen=True)
class MediaRef:
    """The title a message is about."""

    media_type: str  # "movie" | "tv"
    tmdb_id: int
    is_4k: bool
    title: str  # "Dune (2021)"

    @property
    def version(self) -> str:
        return "4K" if self.is_4k else "1080p"


@dataclass(frozen=True)
class DirectMessage:
    to: str  # a Discord user id
    text: str
    about: MediaRef | None = None


Notice = AdminPost | ApprovalPost | DirectMessage


class Notifier(Protocol):
    async def deliver(self, notices: Sequence[Notice]) -> list[Notice]:
        """Send each notice; never raises. Returns the ones that could not be sent."""
        ...
