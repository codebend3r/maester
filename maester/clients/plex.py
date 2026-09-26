"""Plex Media Server: identity, libraries and item lookup for deep links.

Tautulli covers sessions and history better than Plex's own endpoints, so
this client stays small: the machine identifier that deep links need, the
library sections, and item metadata by rating key.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from maester.clients.base import HttpClient


@dataclass(frozen=True)
class Section:
    key: str
    title: str
    type: str  # "movie" | "show"


@dataclass(frozen=True)
class PlexItem:
    rating_key: str
    title: str
    type: str
    year: int | None
    guids: tuple[str, ...]
    files: tuple[str, ...]

    @property
    def tmdb_id(self) -> int | None:
        for guid in self.guids:
            if guid.startswith("tmdb://"):
                return int(guid.removeprefix("tmdb://"))
        return None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> PlexItem:
        files = tuple(
            part.get("file", "")
            for media in raw.get("Media") or []
            for part in media.get("Part") or []
            if part.get("file")
        )
        return cls(
            rating_key=str(raw.get("ratingKey") or ""),
            title=raw.get("title") or "",
            type=raw.get("type") or "",
            year=raw.get("year"),
            guids=tuple(g.get("id", "") for g in raw.get("Guid") or []),
            files=files,
        )


class Plex(Protocol):
    async def machine_identifier(self) -> str: ...
    async def sections(self) -> list[Section]: ...
    async def item(self, rating_key: str) -> PlexItem | None: ...
    def deep_link(self, machine_id: str, rating_key: str) -> str: ...


def deep_link(machine_id: str, rating_key: str) -> str:
    return (
        f"https://app.plex.tv/desktop/#!/server/{machine_id}/details"
        f"?key=%2Flibrary%2Fmetadata%2F{rating_key}"
    )


class PlexClient(HttpClient):
    service = "plex"

    def __init__(self, base_url: str, token: str, **kwargs: Any):
        headers = {"X-Plex-Token": token, "Accept": "application/json"}
        super().__init__(base_url, headers=headers, **kwargs)

    async def machine_identifier(self) -> str:
        data = await self.get_json("/identity")
        return str((data.get("MediaContainer") or {}).get("machineIdentifier") or "")

    async def sections(self) -> list[Section]:
        data = await self.get_json("/library/sections")
        return [
            Section(str(d.get("key")), d.get("title") or "", d.get("type") or "")
            for d in (data.get("MediaContainer") or {}).get("Directory", [])
        ]

    async def item(self, rating_key: str) -> PlexItem | None:
        data = await self.get_json(f"/library/metadata/{rating_key}")
        rows = (data.get("MediaContainer") or {}).get("Metadata") or []
        return PlexItem.from_api(rows[0]) if rows else None

    def deep_link(self, machine_id: str, rating_key: str) -> str:
        return deep_link(machine_id, rating_key)


@dataclass
class FakePlexClient:
    machine_id: str = "fake-machine"
    section_list: list[Section] = field(default_factory=list)
    items: dict[str, PlexItem] = field(default_factory=dict)

    async def machine_identifier(self) -> str:
        return self.machine_id

    async def sections(self) -> list[Section]:
        return list(self.section_list)

    async def item(self, rating_key: str) -> PlexItem | None:
        return self.items.get(rating_key)

    def deep_link(self, machine_id: str, rating_key: str) -> str:
        return deep_link(machine_id, rating_key)
