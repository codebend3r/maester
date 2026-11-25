"""Who is asking: the Supabase access token the page sends, checked with raven.

sparrow runs no sign-in. sparrow's page signs in to the suite's Supabase
project (raven's) and sends the access token as `Authorization: Bearer`;
sparrow asks raven's `/api/me` whose it is, and caches the answer for 30
seconds, so a page's burst of requests costs one lookup and a short raven
outage goes unnoticed. The cache is keyed by the token's hash, so sparrow
keeps no live tokens past the request; the token itself rides along only as
the asker's own key to raven for the tools (`Viewer.chat_user`).

`Auth` is the seam: routes depend on `signed_in`, `approved` or `admin` and
never see the header.

What a request is refused with, as JSON:

- 401 `{reason: "signed_out"}`: no token, or raven doesn't accept it; the
  page signs in again
- 503 `{reason: "sign_in_unavailable"}`: raven can't be reached and nothing
  is cached, so the page says to try again instead of signing in again
- 403 `{reason: "not_approved"}`: signed in, but raven's owner hasn't
  approved the account (or revoked it); the page says to ask raven's owner
- 403 `{reason: "not_admin"}`: an admin route, for anyone else
- 415 `{reason: "json_only"}`: a write that isn't `application/json`, which
  with no CORS headers keeps other sites' forms and scripts out
"""

from __future__ import annotations

import enum
import hashlib
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import Request

from sparrow.agent.tools import Tier
from sparrow.chat.identity import IdentityService
from sparrow.chat.service import ChatUser
from sparrow.clients import ClientError
from sparrow.clients.raven import RavenAccount, RavenServer
from sparrow.store import UserRow

log = logging.getLogger("sparrow.web")

AUTHORIZATION = "authorization"
BEARER = "bearer"
CACHE_TTL = timedelta(seconds=30)


class Reason(enum.StrEnum):
    """Why a request was turned away: the `reason` of its JSON body."""

    SIGNED_OUT = "signed_out"
    SIGN_IN_UNAVAILABLE = "sign_in_unavailable"
    NOT_APPROVED = "not_approved"
    NOT_ADMIN = "not_admin"
    JSON_ONLY = "json_only"
    UNKNOWN_USER = "unknown_user"
    UNKNOWN_CASE = "unknown_case"


class Refused(Exception):
    """A request turned away, with the status to answer with and a body of its `reason`."""

    def __init__(self, status: int, reason: Reason):
        super().__init__(reason)
        self.status = status
        self.body: dict[str, object] = {"reason": reason}


class SignInUnavailable(RuntimeError):
    """raven couldn't be asked, and no recent answer was cached."""


def _utcnow() -> datetime:
    return datetime.now(UTC)


def bearer_token(request: Request) -> str | None:
    """The token of an `Authorization: Bearer <token>` header; None without one."""
    scheme, _, token = request.headers.get(AUTHORIZATION, "").partition(" ")
    token = token.strip()
    return token if scheme.lower() == BEARER and token else None


class AccountVerifier:
    """A token's raven account, remembered for `ttl`."""

    def __init__(
        self,
        raven: RavenServer,
        *,
        ttl: timedelta = CACHE_TTL,
        clock: Callable[[], datetime] = _utcnow,
    ):
        self.raven = raven
        self.ttl = ttl
        self.clock = clock
        self._cache: dict[str, tuple[RavenAccount, datetime]] = {}

    async def account(self, token: str) -> RavenAccount | None:
        """Whose `token` is; None when raven doesn't accept it."""
        now = self.clock()
        key = hashlib.sha256(token.encode()).hexdigest()
        cached = self._cache.get(key)
        if cached is not None and now - cached[1] < self.ttl:
            return cached[0]
        try:
            account = await self.raven.me(token)
        except ClientError as exc:
            raise SignInUnavailable(str(exc)) from exc
        self._forget_stale(now)
        if account is None:
            self._cache.pop(key, None)
        else:
            self._cache[key] = (account, now)
        return account

    def _forget_stale(self, now: datetime) -> None:
        stale = [k for k, (_, asked) in self._cache.items() if now - asked >= self.ttl]
        for key in stale:
            del self._cache[key]


@dataclass(frozen=True)
class Viewer:
    """Who a request is from, their tier right now, and the token they sent (None in the
    sandbox), for their tools' reads of raven."""

    user: UserRow
    tier: Tier
    display_name: str
    raven_token: str | None = None

    @property
    def chat_user(self) -> ChatUser:
        return ChatUser(self.user.user_id, self.display_name, self.raven_token)


def require_json(request: Request) -> None:
    """A dependency for every write route: the body must be JSON."""
    content_type = request.headers.get("content-type", "")
    if content_type.split(";")[0].strip().lower() != "application/json":
        raise Refused(415, Reason.JSON_ONLY)


class Auth:
    def __init__(self, verifier: AccountVerifier, identity: IdentityService):
        self.verifier = verifier
        self.identity = identity

    async def signed_in(self, request: Request) -> Viewer:
        """Anyone raven knows, approved or not."""
        token = bearer_token(request)
        if token is None:
            raise Refused(401, Reason.SIGNED_OUT)
        try:
            account = await self.verifier.account(token)
        except SignInUnavailable:
            log.warning("raven couldn't be asked whose a token is", exc_info=True)
            raise Refused(503, Reason.SIGN_IN_UNAVAILABLE) from None
        if account is None:
            raise Refused(401, Reason.SIGNED_OUT)
        user = await self.identity.refresh(account)
        return Viewer(user, self.identity.tier_for(user.user_id), account.email, token)

    async def approved(self, request: Request) -> Viewer:
        """A friend or above: the chat routes."""
        viewer = await self.signed_in(request)
        if viewer.tier == Tier.UNAPPROVED:
            raise Refused(403, Reason.NOT_APPROVED)
        return viewer

    async def admin(self, request: Request) -> Viewer:
        viewer = await self.approved(request)
        if viewer.tier != Tier.ADMIN:
            raise Refused(403, Reason.NOT_ADMIN)
        return viewer
