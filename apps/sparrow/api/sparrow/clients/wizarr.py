"""Wizarr: the user records whose access expiry the reminders read."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol

from sparrow.clients.base import Downable, HttpClient

# /api/users reconciles with every Plex server per call and routinely takes ~15s.
USER_TIMEOUT = 45.0


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


class Wizarr(Protocol):
    async def ping(self) -> None: ...
    async def list_users(self) -> list[WizarrUser]: ...


class WizarrClient(HttpClient):
    service = "wizarr"
    health_path = "/api/status"  # checks the API key too

    def __init__(self, base_url: str, api_key: str, **kwargs: Any):
        headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
        super().__init__(base_url, headers=headers, **kwargs)

    async def list_users(self) -> list[WizarrUser]:
        data = await self.get_json("/api/users", timeout=USER_TIMEOUT)
        return [WizarrUser.from_api(u) for u in data.get("users", [])]


@dataclass
class FakeWizarrClient(Downable):
    service: ClassVar[str] = "wizarr"

    user_list: list[WizarrUser] = field(default_factory=list)

    async def list_users(self) -> list[WizarrUser]:
        self.refuse_if_down("/api/users")
        return list(self.user_list)
