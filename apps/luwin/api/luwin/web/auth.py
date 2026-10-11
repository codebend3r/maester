"""Who is asking: the `maester_session` cookie rookery set, checked with rookery.

luwin runs no sign-in. rookery signs people in with Plex and sets the
session cookie for the suite; luwin reads it, asks rookery whose it is, and
caches the answer for 30 seconds, so a page's burst of requests costs one
lookup and a short rookery outage goes unnoticed. The cache is keyed by the
token's hash, so luwin keeps no live tokens past the request.

`Auth` is the seam: routes depend on `signed_in`, `linked` or `admin` and
never see the cookie. Should the apps ever live on unrelated domains, a
verifier speaking signed tokens or OIDC replaces `SessionVerifier`, and the
routes behind it don't change.

What a request is refused with, as JSON:

- 401 `{reason: "signed_out", sign_in}`: no cookie, or rookery doesn't know
  it; the page sends the browser to `sign_in` with `return_to`
- 503 `{reason: "sign_in_unavailable"}`: rookery can't be reached and nothing
  is cached, so the page says to try again instead of looping through sign-in
- 403 `{reason: "unlinked", admin}`: signed in, but their Plex account has no
  access; `admin` is the owner's Plex username, whom to ask for an invite
- 403 `{reason: "not_admin"}`: an admin route, for anyone else
- 415 `{reason: "json_only"}`: a write that isn't `application/json`, which
  with no CORS headers keeps other sites' forms and scripts out
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Request

from luwin.agent.tools import Tier
from luwin.chat.identity import IdentityService
from luwin.chat.service import ChatUser
from luwin.clients import Account, ClientError, Rookery
from luwin.store import UserRow

log = logging.getLogger("luwin.web")

COOKIE = "maester_session"
CACHE_TTL = timedelta(seconds=30)


class Refused(Exception):
    """A request turned away, with the status and JSON body to answer with."""

    def __init__(self, status: int, body: dict[str, Any]):
        super().__init__(body.get("reason", ""))
        self.status = status
        self.body = body


class SignInUnavailable(RuntimeError):
    """rookery couldn't be asked, and no recent answer was cached."""


def _utcnow() -> datetime:
    return datetime.now(UTC)


class SessionVerifier:
    """A session token's account, from rookery, remembered for `ttl`."""

    def __init__(
        self,
        rookery: Rookery,
        *,
        ttl: timedelta = CACHE_TTL,
        clock: Callable[[], datetime] = _utcnow,
    ):
        self.rookery = rookery
        self.ttl = ttl
        self.clock = clock
        self._cache: dict[str, tuple[Account, datetime]] = {}

    async def account(self, token: str) -> Account | None:
        """Whose `token` is; None when rookery doesn't know it or it has expired."""
        now = self.clock()
        key = hashlib.sha256(token.encode()).hexdigest()
        cached = self._cache.get(key)
        if cached is not None and now - cached[1] < self.ttl:
            account: Account | None = cached[0]
        else:
            try:
                account = await self.rookery.session(token)
            except ClientError as exc:
                raise SignInUnavailable(str(exc)) from exc
            self._forget_stale(now)
            if account is None:
                self._cache.pop(key, None)
            else:
                self._cache[key] = (account, now)
        if account is None or account.expires_at <= now:
            return None
        return account

    def _forget_stale(self, now: datetime) -> None:
        stale = [k for k, (_, asked) in self._cache.items() if now - asked >= self.ttl]
        for key in stale:
            del self._cache[key]


@dataclass(frozen=True)
class Viewer:
    """Who a request is from, and their tier right now."""

    user: UserRow
    tier: Tier
    display_name: str

    @property
    def chat_user(self) -> ChatUser:
        return ChatUser(self.user.user_id, self.display_name)


def require_json(request: Request) -> None:
    """A dependency for every write route: the body must be JSON."""
    content_type = request.headers.get("content-type", "")
    if content_type.split(";")[0].strip().lower() != "application/json":
        raise Refused(415, {"reason": "json_only"})


class Auth:
    def __init__(self, verifier: SessionVerifier, identity: IdentityService, sign_in: str):
        self.verifier = verifier
        self.identity = identity
        self.sign_in = sign_in  # rookery's login page

    async def signed_in(self, request: Request) -> Viewer:
        """Anyone rookery signed in, linked or not."""
        token = request.cookies.get(COOKIE)
        if not token:
            raise self._signed_out()
        try:
            account = await self.verifier.account(token)
        except SignInUnavailable:
            log.warning("rookery couldn't be asked who a session belongs to", exc_info=True)
            raise Refused(503, {"reason": "sign_in_unavailable"}) from None
        if account is None:
            raise self._signed_out()
        await self.identity.load_owner()
        user = await self.identity.refresh(account)
        name = account.display_name or user.plex_username or user.user_id
        return Viewer(user, self.identity.tier_for(user.user_id), name)

    async def linked(self, request: Request) -> Viewer:
        """A friend or above: the chat and inbox routes."""
        viewer = await self.signed_in(request)
        if viewer.tier == Tier.UNLINKED:
            owner = self.identity.owner
            admin = owner.username if owner else None
            raise Refused(403, {"reason": "unlinked", "admin": admin})
        return viewer

    async def admin(self, request: Request) -> Viewer:
        viewer = await self.signed_in(request)
        if viewer.tier != Tier.ADMIN:
            raise Refused(403, {"reason": "not_admin"})
        return viewer

    def _signed_out(self) -> Refused:
        return Refused(401, {"reason": "signed_out", "sign_in": self.sign_in})
