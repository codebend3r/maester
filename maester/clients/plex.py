"""Plex Media Server: identity, libraries and item lookup for deep links.

Tautulli covers sessions and history better than Plex's own endpoints, so
this client stays small: the machine identifier that deep links need, the
library sections, item metadata by rating key (with every version of the
item), and a show's seasons with how many episodes each has.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from maester.clients.base import HttpClient

# The server's own 4K re-encodes are written next to the original as
# "<Movie> (<year>) 2160p HEVC.mkv"; the name is what sets them apart.
REENCODE_MARKER = "2160p hevc"


@dataclass(frozen=True)
class Section:
    key: str
    title: str
    type: str  # "movie" | "show"


@dataclass(frozen=True)
class Version:
    """One copy of an item: Plex lists every file it has for a title as a Media entry."""

    resolution: str  # Plex's videoResolution: "4k", "1080", "720", "sd"
    video_codec: str
    bitrate_kbps: int
    size_bytes: int
    file: str

    @property
    def label(self) -> str:
        """How a friend would name this copy: "1080p", "4K", or "4K HEVC re-encode"."""
        if REENCODE_MARKER in self.file.lower():
            return "4K HEVC re-encode"
        return {"4k": "4K", "sd": "SD"}.get(self.resolution.lower(), f"{self.resolution}p")

    @classmethod
    def from_api(cls, media: dict[str, Any]) -> Version:
        parts = media.get("Part") or []
        return cls(
            resolution=str(media.get("videoResolution") or ""),
            video_codec=media.get("videoCodec") or "",
            bitrate_kbps=int(media.get("bitrate") or 0),
            size_bytes=sum(int(p.get("size") or 0) for p in parts),
            file=parts[0].get("file", "") if parts else "",
        )


@dataclass(frozen=True)
class PlexItem:
    rating_key: str
    title: str
    type: str
    year: int | None
    guids: tuple[str, ...]
    versions: tuple[Version, ...]

    @property
    def files(self) -> tuple[str, ...]:
        return tuple(v.file for v in self.versions if v.file)

    @property
    def tmdb_id(self) -> int | None:
        for guid in self.guids:
            if guid.startswith("tmdb://"):
                return int(guid.removeprefix("tmdb://"))
        return None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> PlexItem:
        return cls(
            rating_key=str(raw.get("ratingKey") or ""),
            title=raw.get("title") or "",
            type=raw.get("type") or "",
            year=raw.get("year"),
            guids=tuple(g.get("id", "") for g in raw.get("Guid") or []),
            versions=tuple(Version.from_api(m) for m in raw.get("Media") or []),
        )


@dataclass(frozen=True)
class PlexSeason:
    number: int
    episodes: int  # how many episodes of the season are in the library


class Plex(Protocol):
    async def machine_identifier(self) -> str: ...
    async def sections(self) -> list[Section]: ...
    async def item(self, rating_key: str) -> PlexItem | None: ...
    async def seasons(self, rating_key: str) -> list[PlexSeason]: ...
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

    async def seasons(self, rating_key: str) -> list[PlexSeason]:
        data = await self.get_json(f"/library/metadata/{rating_key}/children")
        return [
            PlexSeason(int(s["index"]), int(s.get("leafCount") or 0))
            for s in (data.get("MediaContainer") or {}).get("Metadata") or []
            if s.get("type") == "season"
        ]

    def deep_link(self, machine_id: str, rating_key: str) -> str:
        return deep_link(machine_id, rating_key)


@dataclass
class FakePlexClient:
    machine_id: str = "fake-machine"
    section_list: list[Section] = field(default_factory=list)
    items: dict[str, PlexItem] = field(default_factory=dict)
    show_seasons: dict[str, list[PlexSeason]] = field(default_factory=dict)

    async def machine_identifier(self) -> str:
        return self.machine_id

    async def sections(self) -> list[Section]:
        return list(self.section_list)

    async def item(self, rating_key: str) -> PlexItem | None:
        return self.items.get(rating_key)

    async def seasons(self, rating_key: str) -> list[PlexSeason]:
        return list(self.show_seasons.get(rating_key, []))

    def deep_link(self, machine_id: str, rating_key: str) -> str:
        return deep_link(machine_id, rating_key)
