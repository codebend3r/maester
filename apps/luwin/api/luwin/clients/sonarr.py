from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import TYPE_CHECKING, Any, ClassVar, Protocol

from luwin.clients.arr import Arr, ArrClient, FakeArr, RootFolder, roomy

if TYPE_CHECKING:
    from luwin.clients.seerr import MediaDetails


@dataclass(frozen=True)
class Series:
    id: int
    title: str
    tvdb_id: int
    year: int | None
    path: str
    monitored: bool
    series_type: str  # "standard" | "anime" | "daily"
    season_numbers: tuple[int, ...]

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Series:
        return cls(
            id=int(raw.get("id") or 0),
            title=raw.get("title") or "",
            tvdb_id=int(raw.get("tvdbId") or 0),
            year=raw.get("year"),
            path=raw.get("path") or "",
            monitored=bool(raw.get("monitored", False)),
            series_type=raw.get("seriesType") or "standard",
            season_numbers=tuple(int(s["seasonNumber"]) for s in raw.get("seasons") or []),
        )


@dataclass(frozen=True)
class Episode:
    id: int
    series_id: int
    season: int
    number: int
    title: str
    has_file: bool
    file_id: int | None
    monitored: bool
    aired: datetime | None = None  # when it first aired; None when not yet known

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Episode:
        aired = raw.get("airDateUtc")
        return cls(
            id=int(raw["id"]),
            series_id=int(raw.get("seriesId") or 0),
            season=int(raw.get("seasonNumber") or 0),
            number=int(raw.get("episodeNumber") or 0),
            title=raw.get("title") or "",
            has_file=bool(raw.get("hasFile", False)),
            file_id=int(raw["episodeFileId"]) if raw.get("episodeFileId") else None,
            monitored=bool(raw.get("monitored", False)),
            aired=datetime.fromisoformat(aired) if aired else None,
        )


class Sonarr(Arr, Protocol):
    async def series(self) -> list[Series]: ...
    async def series_by_tvdb(self, tvdb_id: int) -> Series | None: ...
    async def lookup(self, term: str) -> list[Series]: ...
    async def episodes(self, series_id: int) -> list[Episode]: ...
    async def follow(self, series_id: int) -> None: ...


class SonarrClient(ArrClient):
    service = "sonarr"
    history_scope = ("series", "seriesId")
    queue_includes = ("includeUnknownSeriesItems", "includeSeries", "includeEpisode")
    file_scope = ("episodefile", "seriesId")
    search_command = ("EpisodeSearch", "episodeIds")

    async def series(self) -> list[Series]:
        return [Series.from_api(s) for s in await self.get_json(f"{self.api}/series")]

    async def series_by_tvdb(self, tvdb_id: int) -> Series | None:
        rows = await self.get_json(f"{self.api}/series", params={"tvdbId": tvdb_id})
        return Series.from_api(rows[0]) if rows else None

    async def lookup(self, term: str) -> list[Series]:
        return [
            Series.from_api(s)
            for s in await self.get_json(f"{self.api}/series/lookup", params={"term": term})
        ]

    async def episodes(self, series_id: int) -> list[Episode]:
        return [
            Episode.from_api(e)
            for e in await self.get_json(f"{self.api}/episode", params={"seriesId": series_id})
        ]

    async def find_id(self, details: MediaDetails) -> int | None:
        """The series' id here, by its TVDB id; None when this Sonarr hasn't it (or Seerr
        knows no TVDB id to ask by)."""
        if details.tvdb_id is None:
            return None
        series = await self.series_by_tvdb(details.tvdb_id)
        return series.id if series else None

    async def follow(self, series_id: int) -> None:
        """Monitor the show and every season Sonarr learns of from now on."""
        raw = await self.get_json(f"{self.api}/series/{series_id}")
        raw["monitored"] = True
        raw["monitorNewItems"] = "all"
        await self.put_json(f"{self.api}/series/{series_id}", raw)


@dataclass
class FakeSonarrClient(FakeArr):
    service: ClassVar[str] = "sonarr"

    roots: list[RootFolder] = field(default_factory=lambda: roomy("/TV"))
    series_list: list[Series] = field(default_factory=list)
    episode_list: list[Episode] = field(default_factory=list)
    followed: list[int] = field(default_factory=list)

    async def series(self) -> list[Series]:
        return list(self.series_list)

    async def series_by_tvdb(self, tvdb_id: int) -> Series | None:
        return next((s for s in self.series_list if s.tvdb_id == tvdb_id), None)

    async def lookup(self, term: str) -> list[Series]:
        return [s for s in self.series_list if term.lower() in s.title.lower()]

    async def episodes(self, series_id: int) -> list[Episode]:
        return [e for e in self.episode_list if e.series_id == series_id]

    async def find_id(self, details: MediaDetails) -> int | None:
        if details.tvdb_id is None:
            return None
        series = await self.series_by_tvdb(details.tvdb_id)
        return series.id if series else None

    async def follow(self, series_id: int) -> None:
        self.followed.append(series_id)
        self.series_list = [
            replace(s, monitored=True) if s.id == series_id else s for s in self.series_list
        ]
