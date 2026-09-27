"""SABnzbd: the download queue and history, per host."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from maester.clients.base import ClientError, HttpClient


@dataclass(frozen=True)
class Download:
    nzo_id: str
    name: str
    status: str
    percent: float
    size_mb: float
    time_left: str | None
    fail_message: str | None = None

    @classmethod
    def from_queue(cls, raw: dict[str, Any]) -> Download:
        return cls(
            nzo_id=raw.get("nzo_id") or "",
            name=raw.get("filename") or "",
            status=raw.get("status") or "",
            percent=float(raw.get("percentage") or 0),
            size_mb=float(str(raw.get("mb") or 0)),
            time_left=raw.get("timeleft"),
        )

    @classmethod
    def from_history(cls, raw: dict[str, Any]) -> Download:
        return cls(
            nzo_id=raw.get("nzo_id") or "",
            name=raw.get("name") or "",
            status=raw.get("status") or "",
            percent=100.0 if raw.get("status") == "Completed" else 0.0,
            size_mb=float(raw.get("bytes") or 0) / 1_048_576,
            time_left=None,
            fail_message=raw.get("fail_message") or None,
        )


class Sabnzbd(Protocol):
    host: str

    async def ping(self) -> None: ...
    async def queue(self) -> list[Download]: ...
    async def history(self, limit: int = 50) -> list[Download]: ...


class SabnzbdClient(HttpClient):
    service = "sabnzbd"

    def __init__(self, host: str, base_url: str, api_key: str, **kwargs: Any):
        super().__init__(base_url, params={"apikey": api_key, "output": "json"}, **kwargs)
        self.host = host

    async def ping(self) -> None:
        """SABnzbd's version, which it gives without the API key: it answers while it runs."""
        await self.get_json("/api", params={"mode": "version"})

    async def queue(self) -> list[Download]:
        data = await self.get_json("/api", params={"mode": "queue"})
        return [Download.from_queue(s) for s in (data.get("queue") or {}).get("slots", [])]

    async def history(self, limit: int = 50) -> list[Download]:
        data = await self.get_json("/api", params={"mode": "history", "limit": limit})
        return [Download.from_history(s) for s in (data.get("history") or {}).get("slots", [])]


@dataclass
class FakeSabnzbdClient:
    host: str = "fake"
    queue_items: list[Download] = field(default_factory=list)
    history_items: list[Download] = field(default_factory=list)
    down: bool = False  # while set, it answers like an unreachable SABnzbd

    async def ping(self) -> None:
        if self.down:
            raise ClientError("sabnzbd", "GET", "/api?mode=version", None, "connection refused")

    async def queue(self) -> list[Download]:
        return list(self.queue_items)

    async def history(self, limit: int = 50) -> list[Download]:
        return self.history_items[:limit]
