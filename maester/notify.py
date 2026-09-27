"""Messages maester sends outside a reply, and the one interface that delivers them.

Tools, button decisions and webhooks all produce `Notice`s: a post in the
admin channel (with Approve/Deny buttons when it carries an approval) or a
DM to one user. Only the chat layer knows how to deliver them; everything
else hands them to a `Notifier`, which the Discord bot implements, so
`agent/`, `tools/` and `web/` never import Discord.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from maester.store import PendingAction


@dataclass(frozen=True)
class Notice:
    text: str
    # A Discord user id to DM; None posts in the admin channel.
    to: str | None = None
    # Admin-channel notices only: the pending action its Approve/Deny buttons settle.
    approval: PendingAction | None = None

    def __post_init__(self) -> None:
        if self.approval is not None and self.to is not None:
            raise ValueError("only admin-channel notices carry approval buttons")


class Notifier(Protocol):
    async def deliver(self, notices: Sequence[Notice]) -> None: ...
