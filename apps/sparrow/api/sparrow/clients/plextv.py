"""plex.tv: who owns the server.

`GET /api/v2/user` with the owner's token (`PLEX_TOKEN`) is the token's own
account, which is the server's owner, as JSON; sparrow's admin is whoever
signs in with that account.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol

from sparrow.clients.base import ClientError, Downable, HttpClient


@dataclass(frozen=True)
class PlexAccount:
    """A Plex account, by the id plex.tv gives it."""

    id: str
    username: str
    email: str


class PlexTv(Protocol):
    async def account(self) -> PlexAccount: ...


class PlexTvClient(HttpClient):
    service = "plex.tv"

    def __init__(self, base_url: str, token: str, **kwargs: Any):
        headers = {
            "X-Plex-Token": token,
            "X-Plex-Client-Identifier": "maester",
            "X-Plex-Product": "maester",
        }
        super().__init__(base_url, headers=headers, **kwargs)

    async def account(self) -> PlexAccount:
        raw = await self.get_json("/api/v2/user", headers={"Accept": "application/json"})
        try:
            return PlexAccount(str(raw["id"]), raw.get("username") or "", raw.get("email") or "")
        except (KeyError, TypeError) as exc:
            raise ClientError(self.service, "GET", "/api/v2/user", 200, "no account id") from exc


@dataclass
class FakePlexTv(Downable):
    service: ClassVar[str] = "plex.tv"

    # The account `PLEX_TOKEN` belongs to: the server's owner.
    owner: PlexAccount = field(default_factory=lambda: PlexAccount("1", "boss", "boss@example.com"))

    async def account(self) -> PlexAccount:
        self.refuse_if_down("/api/v2/user")
        return self.owner
