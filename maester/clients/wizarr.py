"""Wizarr: invites and user records, with the quirks learned in wizteros.

Two things the API does not tell you:

- `expires_in_days` is routed through a fixed lookup ({1: day, 7: week,
  30: month}) and anything else falls back to "never". An unhonored number
  does not shorten the invite, it removes the expiry, so values are snapped
  up to the next honored one before sending.
- An invitation's `used_by` is serialized as the repr "<User 281>" rather
  than a name. The number is the redeeming user record's id.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol

from maester.clients.base import Downable, HttpClient

EXPIRY_DAYS_HONORED = (1, 7, 30)
# /api/users reconciles with every Plex server per call and routinely takes
# ~15s; per-user writes are as slow. A short timeout used to leave an invite
# half-applied while the write still landed server-side.
USER_TIMEOUT = 45.0

_USED_BY_REPR = re.compile(r"\s*<User (\d+)>\s*")


def honored_expiry_days(days: int) -> int:
    """The shortest expiry Wizarr honors that is no shorter than `days`."""
    return next((d for d in EXPIRY_DAYS_HONORED if d >= days), EXPIRY_DAYS_HONORED[-1])


@dataclass(frozen=True)
class Invite:
    id: int
    code: str
    url: str
    used_by: str | None = None
    expires: str | None = None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Invite:
        return cls(
            id=int(raw.get("id") or 0),
            code=raw.get("code") or "",
            url=raw.get("url") or "",
            used_by=raw.get("used_by") or None,
            expires=raw.get("expires") or None,
        )


@dataclass(frozen=True)
class Library:
    """A library Wizarr can share, on one of its Plex servers."""

    id: int
    name: str  # as Plex names it, "01. Movies"
    server_id: int
    server_name: str
    enabled: bool = True

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Library:
        return cls(
            id=int(raw["id"]),
            name=raw.get("name") or "",
            server_id=int(raw.get("server_id") or 0),
            server_name=raw.get("server_name") or "",
            enabled=bool(raw.get("enabled", True)),
        )


@dataclass(frozen=True)
class WizarrUser:
    id: int
    username: str
    email: str
    expires: str | None
    server_name: str

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> WizarrUser:
        return cls(
            id=int(raw["id"]),
            username=raw.get("username") or "",
            email=(raw.get("email") or "").lower(),
            expires=raw.get("expires") or None,
            server_name=raw.get("server_name") or "",
        )


def redeemer(invite: Invite, users: list[WizarrUser]) -> WizarrUser | None:
    """The user record that redeemed `invite`, resolving either `used_by` shape."""
    if not invite.used_by:
        return None
    match = _USED_BY_REPR.fullmatch(invite.used_by)
    if match:
        record_id = int(match.group(1))
        return next((u for u in users if u.id == record_id), None)
    return next((u for u in users if u.username.lower() == invite.used_by.lower()), None)


class Wizarr(Protocol):
    async def ping(self) -> None: ...
    async def libraries(self) -> list[Library]: ...
    async def create_invite(
        self,
        *,
        expires_in_days: int,
        duration: str,
        library_ids: list[int] | None = None,
        server_ids: list[int] | None = None,
    ) -> Invite: ...
    async def list_invites(self) -> list[Invite]: ...
    async def list_users(self) -> list[WizarrUser]: ...
    async def find_users_by_email(self, email: str) -> list[WizarrUser]: ...
    async def set_expiry(self, user_id: int, expires_iso: str | None) -> None: ...
    async def disable_user(self, user_id: int) -> None: ...


class WizarrClient(HttpClient):
    service = "wizarr"
    health_path = "/api/status"  # checks the API key too

    def __init__(self, base_url: str, api_key: str, **kwargs: Any):
        headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
        super().__init__(base_url, headers=headers, **kwargs)

    async def server_ids(self) -> list[int]:
        data = await self.get_json("/api/servers")
        return [int(s["id"]) for s in data.get("servers", [])]

    async def libraries(self) -> list[Library]:
        """Every library Wizarr knows, on every server."""
        return [
            Library.from_api(lib)
            for lib in (await self.get_json("/api/libraries")).get("libraries", [])
        ]

    async def create_invite(
        self,
        *,
        expires_in_days: int,
        duration: str,
        library_ids: list[int] | None = None,
        server_ids: list[int] | None = None,
    ) -> Invite:
        """An invite to `server_ids` (every server when None), scoped to `library_ids`
        (Wizarr's defaults when None). `duration` is days of access once joined, or
        "unlimited"."""
        body: dict[str, Any] = {
            "server_ids": server_ids if server_ids is not None else await self.server_ids(),
            "expires_in_days": honored_expiry_days(expires_in_days),
            "duration": duration,
            "unlimited": False,
            "allow_downloads": False,
        }
        if library_ids is not None:
            body["library_ids"] = list(library_ids)
        return Invite.from_api((await self.post_json("/api/invitations", body))["invitation"])

    async def list_invites(self) -> list[Invite]:
        return [
            Invite.from_api(i)
            for i in (await self.get_json("/api/invitations")).get("invitations", [])
        ]

    async def list_users(self) -> list[WizarrUser]:
        data = await self.get_json("/api/users", timeout=USER_TIMEOUT)
        return [WizarrUser.from_api(u) for u in data.get("users", [])]

    async def find_users_by_email(self, email: str) -> list[WizarrUser]:
        data = await self.get_json("/api/users", params={"email": email}, timeout=USER_TIMEOUT)
        return [
            u
            for u in (WizarrUser.from_api(r) for r in data.get("users", []))
            if u.email == email.lower()
        ]

    async def set_expiry(self, user_id: int, expires_iso: str | None) -> None:
        # Wizarr rejects a literal null against its date-time schema, so
        # clearing to unlimited omits the key entirely.
        body = {} if expires_iso is None else {"expires": expires_iso}
        await self.put_json(f"/api/users/{user_id}/update-expiry", body, timeout=USER_TIMEOUT)

    async def disable_user(self, user_id: int) -> None:
        await self.post_json(f"/api/users/{user_id}/disable", timeout=USER_TIMEOUT)


@dataclass
class FakeWizarrClient(Downable):
    service: ClassVar[str] = "wizarr"

    invites: list[Invite] = field(default_factory=list)
    user_list: list[WizarrUser] = field(default_factory=list)
    library_list: list[Library] = field(default_factory=list)
    disabled: list[int] = field(default_factory=list)
    expiries: dict[int, str | None] = field(default_factory=dict)
    # What each invite was asked for: expiry, duration, libraries and servers.
    asked: list[dict[str, Any]] = field(default_factory=list)

    async def libraries(self) -> list[Library]:
        self.refuse_if_down("/api/libraries")
        return list(self.library_list)

    async def create_invite(
        self,
        *,
        expires_in_days: int,
        duration: str,
        library_ids: list[int] | None = None,
        server_ids: list[int] | None = None,
    ) -> Invite:
        self.refuse_if_down("/api/invitations")
        code = f"FAKE{len(self.invites) + 1:03d}"
        # Like Wizarr's API, the url is a path on Wizarr's own host.
        inv = Invite(id=len(self.invites) + 1, code=code, url=f"/j/{code}")
        self.invites.append(inv)
        self.asked.append(
            {
                "expires_in_days": honored_expiry_days(expires_in_days),
                "duration": duration,
                "library_ids": library_ids,
                "server_ids": server_ids,
            }
        )
        return inv

    async def list_invites(self) -> list[Invite]:
        return list(self.invites)

    async def list_users(self) -> list[WizarrUser]:
        self.refuse_if_down("/api/users")
        return list(self.user_list)

    async def find_users_by_email(self, email: str) -> list[WizarrUser]:
        return [u for u in self.user_list if u.email == email.lower()]

    async def set_expiry(self, user_id: int, expires_iso: str | None) -> None:
        self.expiries[user_id] = expires_iso

    async def disable_user(self, user_id: int) -> None:
        self.disabled.append(user_id)
