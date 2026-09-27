"""The Seerr webhook: one route for every notification type.

Seerr's webhook agent sends its "Authorization Header" setting as the
`Authorization` header; it must equal `SEERR_WEBHOOK_SECRET`, and with no
secret configured the route refuses everything. Each notification type maps
to a route (`maester/seerr_events.py`) whose handler returns the notices to
send, which go out through the injected `Notifier`; types without a route
are acknowledged and ignored, so ticking more types in Seerr is harmless.

A route that dedupes claims the event in `webhook_events` before its
handler runs, so a repeat inside its window is acknowledged without acting
twice. The claim is released when the handler fails or a notice it produced
could not be delivered, so a later delivery can try again.
"""

from __future__ import annotations

import hmac
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Header, HTTPException

from maester.notify import Notifier
from maester.seerr_events import SeerrNotification, SeerrRoute
from maester.store import Store

log = logging.getLogger("maester.web")

SOURCE = "seerr"


@dataclass(frozen=True)
class SeerrWebhook:
    secret: str
    routes: Mapping[str, SeerrRoute]
    store: Store
    notifier: Notifier

    def authorized(self, header: str) -> bool:
        return bool(self.secret) and hmac.compare_digest(header.encode(), self.secret.encode())

    async def receive(self, notification: SeerrNotification) -> str:
        """Handle one delivery; returns what became of it."""
        route = self.routes.get(notification.type)
        if route is None:
            return "ignored"
        key = notification.event_key
        claimed = route.dedupe is not None
        if claimed and not self.store.claim_event(SOURCE, key, window=route.dedupe):
            return "duplicate"
        try:
            notices = await route.handle(notification)
        except Exception:
            if claimed:
                self.store.release_event(SOURCE, key)
            log.exception("seerr %s failed", key)
            raise
        if await self.notifier.deliver(notices):
            if claimed:
                self.store.release_event(SOURCE, key)
            return "undelivered"
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
