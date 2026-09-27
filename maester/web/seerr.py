"""The Seerr webhook: one route for every notification type.

Seerr's webhook agent sends its "Authorization Header" setting as the
`Authorization` header; it must equal `SEERR_WEBHOOK_SECRET`, and with no
secret configured the route refuses everything. Each notification type maps
to a handler (`maester/seerr_events.py`) that returns the notices to send,
which go out through the injected `Notifier`; types without a handler are
acknowledged and ignored, so ticking more types in Seerr is harmless.

A delivery is claimed in `webhook_events` before its handler runs, so a
repeat of the same event (same type, same request or issue) within a day is
acknowledged without acting twice. A handler that fails releases its claim,
so a later delivery can try again.
"""

from __future__ import annotations

import hmac
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Header, HTTPException

from maester.notify import Notifier
from maester.seerr_events import SeerrHandler, SeerrNotification
from maester.store import Store

log = logging.getLogger("maester.web")

SOURCE = "seerr"
# Seerr repeats an event within minutes (a rescan) or hours; later is news.
DEDUPE_WINDOW = timedelta(hours=24)


@dataclass(frozen=True)
class SeerrWebhook:
    secret: str
    handlers: Mapping[str, SeerrHandler]
    store: Store
    notifier: Notifier

    def authorized(self, header: str) -> bool:
        return bool(self.secret) and hmac.compare_digest(header.encode(), self.secret.encode())

    async def receive(self, notification: SeerrNotification) -> str:
        """Handle one delivery once; returns what became of it."""
        handler = self.handlers.get(notification.type)
        if handler is None:
            return "ignored"
        key = notification.event_key
        if not self.store.claim_event(SOURCE, key, window=DEDUPE_WINDOW):
            return "duplicate"
        try:
            notices = await handler(notification)
        except Exception:
            self.store.release_event(SOURCE, key)
            log.exception("seerr %s failed", key)
            raise
        await self.notifier.deliver(notices)
        return "handled"

    def router(self) -> APIRouter:
        router = APIRouter()

        @router.post("/webhooks/seerr")
        async def seerr_webhook(
            payload: dict[str, Any], authorization: str = Header(default="")
        ) -> dict[str, str]:
            if not self.authorized(authorization):
                raise HTTPException(status_code=401, detail="bad or missing webhook secret")
            try:
                notification = SeerrNotification.from_webhook(payload)
            except (KeyError, TypeError, ValueError) as exc:
                raise HTTPException(422, f"not a Seerr notification: {exc}") from exc
            return {"status": await self.receive(notification)}

        return router
