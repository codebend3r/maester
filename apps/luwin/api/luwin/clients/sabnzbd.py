"""SABnzbd: the download queue and history, per host."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol

from luwin.clients.base import ClientError, Downable, HttpClient

# The stages of a finished download whose lines explain a failure; the rest
# (download speed, the source) only repeat what worked.
TROUBLE_STAGES = {"repair", "unpack", "script", "filejoin", "fail"}


@dataclass(frozen=True)
class Download:
    nzo_id: str
    name: str
    status: str
    percent: float
    size_mb: float
    time_left: str | None
    fail_message: str | None = None
    # A finished download's steps that said something went wrong: "Repair: 18 blocks short".
    trouble: tuple[str, ...] = ()
    completed: int | None = None  # when it finished, as a Unix time

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
            trouble=tuple(
                f"{stage.get('name') or '?'}: {action}"
                for stage in raw.get("stage_log") or []
                if (stage.get("name") or "").lower() in TROUBLE_STAGES
                for action in stage.get("actions") or []
                if action
            ),
            completed=int(raw["completed"]) if raw.get("completed") else None,
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
        """The shortest queue read: it needs the API key, and SABnzbd refuses a wrong one
        in the body (`"status": false`), not with an HTTP error."""
        path = "/api?mode=queue"
        data = await self.get_json("/api", params={"mode": "queue", "limit": 1})
        if isinstance(data, dict) and data.get("status") is False:
            raise ClientError(self.service, "GET", path, 200, data.get("error") or "refused")

    async def queue(self) -> list[Download]:
        data = await self.get_json("/api", params={"mode": "queue"})
        return [Download.from_queue(s) for s in (data.get("queue") or {}).get("slots", [])]

    async def history(self, limit: int = 50) -> list[Download]:
        data = await self.get_json("/api", params={"mode": "history", "limit": limit})
        return [Download.from_history(s) for s in (data.get("history") or {}).get("slots", [])]


@dataclass
class FakeSabnzbdClient(Downable):
    service: ClassVar[str] = "sabnzbd"

    host: str = "fake"
    queue_items: list[Download] = field(default_factory=list)
    history_items: list[Download] = field(default_factory=list)

    async def queue(self) -> list[Download]:
        return list(self.queue_items)

    async def history(self, limit: int = 50) -> list[Download]:
        return self.history_items[:limit]
