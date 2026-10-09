"""rookery: who a `maester_session` cookie belongs to.

rookery owns the suite's sign-in (Sign in with Plex) and sets the session
cookie every app sees. luwin runs no sign-in of its own: it asks rookery, on
the LAN, who a cookie's token belongs to, with the service token rookery
was given for luwin:

- `POST /internal/session` with `{token}`: 200 with the account, 404 when
  the session is unknown or expired, 401 when the service token is wrong

The token travels in the body so it stays out of access logs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, ClassVar, Protocol

from luwin.clients.base import ClientError, Downable, HttpClient

SESSION_PATH = "/internal/session"


@dataclass(frozen=True)
class Account:
    """A signed-in person: rookery's user, and the Plex account they signed in with."""

    user_id: str
    display_name: str
    email: str
    thumb: str
    plex_id: str
    plex_username: str
    plex_email: str
    expires_at: datetime

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Account:
        user, plex = raw["user"], raw["plex"]
        return cls(
            user_id=str(user["id"]),
            display_name=user.get("display_name") or "",
            email=user.get("email") or "",
            thumb=user.get("thumb") or "",
            plex_id=str(plex["id"]),
            plex_username=plex.get("username") or "",
            plex_email=plex.get("email") or "",
            expires_at=_aware(datetime.fromisoformat(raw["expires_at"])),
        )


def _aware(when: datetime) -> datetime:
    """rookery writes UTC; a time without an offset is read as UTC too."""
    return when if when.tzinfo is not None else when.replace(tzinfo=UTC)


class Rookery(Protocol):
    async def session(self, token: str) -> Account | None: ...


class RookeryClient(HttpClient):
    service = "rookery"
    health_path = "/health"

    def __init__(self, base_url: str, service_token: str, **kwargs: Any):
        headers = {"Authorization": f"Bearer {service_token}"}
        super().__init__(base_url, headers=headers, **kwargs)

    async def session(self, token: str) -> Account | None:
        """The account a session token belongs to; None when rookery doesn't know it or it
        expired. Anything else (rookery down, the service token refused) raises."""
        try:
            raw = await self.post_json(SESSION_PATH, {"token": token})
        except ClientError as exc:
            if exc.status == 404:
                return None
            raise
        try:
            return Account.from_api(raw)
        except (KeyError, TypeError, ValueError) as exc:
            raise ClientError(self.service, "POST", SESSION_PATH, 200, "unexpected body") from exc


@dataclass
class FakeRookery(Downable):
    service: ClassVar[str] = "rookery"

    sessions: dict[str, Account] = field(default_factory=dict)  # by token
    # Every token asked about, in order, so a test can see what the cache saved.
    asked: list[str] = field(default_factory=list)

    async def session(self, token: str) -> Account | None:
        self.refuse_if_down(SESSION_PATH)
        self.asked.append(token)
        return self.sessions.get(token)
