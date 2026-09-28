from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any, Protocol

from maester.clients.arr import ArrClient, DiskSpace, HistoryEvent, MediaFile, QueueItem


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

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Episode:
        return cls(
            id=int(raw["id"]),
            series_id=int(raw.get("seriesId") or 0),
            season=int(raw.get("seasonNumber") or 0),
            number=int(raw.get("episodeNumber") or 0),
            title=raw.get("title") or "",
            has_file=bool(raw.get("hasFile", False)),
            file_id=int(raw["episodeFileId"]) if raw.get("episodeFileId") else None,
            monitored=bool(raw.get("monitored", False)),
        )


class Sonarr(Protocol):
    host: str
    base_url: str

    async def root_folders(self) -> list[str]: ...
    async def disk_space(self) -> list[DiskSpace]: ...
    async def queue(self) -> list[QueueItem]: ...
    async def history(self, media_id: int) -> list[HistoryEvent]: ...
    async def series(self) -> list[Series]: ...
    async def series_by_tvdb(self, tvdb_id: int) -> Series | None: ...
    async def lookup(self, term: str) -> list[Series]: ...
    async def episodes(self, series_id: int) -> list[Episode]: ...
    async def episode_files(self, series_id: int) -> list[MediaFile]: ...
    async def delete_episode_file(self, file_id: int) -> None: ...
    async def episode_search(self, episode_ids: list[int]) -> int: ...
    async def mark_failed(self, history_id: int) -> None: ...
    async def follow(self, series_id: int) -> None: ...


class SonarrClient(ArrClient):
    service = "sonarr"
    history_scope = ("series", "seriesId")

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

    async def episode_files(self, series_id: int) -> list[MediaFile]:
        rows = await self.get_json(f"{self.api}/episodefile", params={"seriesId": series_id})
        return [MediaFile.from_api(r) for r in rows]

    async def delete_episode_file(self, file_id: int) -> None:
        await self.delete(f"{self.api}/episodefile/{file_id}")

    async def episode_search(self, episode_ids: list[int]) -> int:
        return await self.command("EpisodeSearch", episodeIds=episode_ids)

    async def follow(self, series_id: int) -> None:
        """Monitor the show and every season Sonarr learns of from now on."""
        raw = await self.get_json(f"{self.api}/series/{series_id}")
        raw["monitored"] = True
        raw["monitorNewItems"] = "all"
        await self.put_json(f"{self.api}/series/{series_id}", raw)


@dataclass
class FakeSonarrClient:
    host: str = "fake"
    base_url: str = ""
    roots: list[str] = field(default_factory=lambda: ["/TV"])
    disks: list[DiskSpace] = field(default_factory=list)
    queue_items: list[QueueItem] = field(default_factory=list)
    # Download history per movie or series id, newest first.
    events: dict[int, list[HistoryEvent]] = field(default_factory=dict)
    series_list: list[Series] = field(default_factory=list)
    episode_list: list[Episode] = field(default_factory=list)
    files: list[MediaFile] = field(default_factory=list)
    failed: list[int] = field(default_factory=list)
    searched: list[list[int]] = field(default_factory=list)
    deleted: list[int] = field(default_factory=list)
    followed: list[int] = field(default_factory=list)

    async def root_folders(self) -> list[str]:
        return list(self.roots)

    async def disk_space(self) -> list[DiskSpace]:
        return list(self.disks)

    async def queue(self) -> list[QueueItem]:
        return list(self.queue_items)

    async def history(self, media_id: int) -> list[HistoryEvent]:
        return list(self.events.get(media_id, []))

    async def series(self) -> list[Series]:
        return list(self.series_list)

    async def series_by_tvdb(self, tvdb_id: int) -> Series | None:
        return next((s for s in self.series_list if s.tvdb_id == tvdb_id), None)

    async def lookup(self, term: str) -> list[Series]:
        return [s for s in self.series_list if term.lower() in s.title.lower()]

    async def episodes(self, series_id: int) -> list[Episode]:
        return [e for e in self.episode_list if e.series_id == series_id]

    async def episode_files(self, series_id: int) -> list[MediaFile]:
        return [f for f in self.files if f.media_id == series_id]

    async def delete_episode_file(self, file_id: int) -> None:
        self.deleted.append(file_id)
        self.files = [f for f in self.files if f.id != file_id]

    async def episode_search(self, episode_ids: list[int]) -> int:
        self.searched.append(list(episode_ids))
        return len(self.searched)

    async def mark_failed(self, history_id: int) -> None:
        self.failed.append(history_id)

    async def follow(self, series_id: int) -> None:
        self.followed.append(series_id)
        self.series_list = [
            replace(s, monitored=True) if s.id == series_id else s for s in self.series_list
        ]
