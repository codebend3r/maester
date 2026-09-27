from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from maester.clients.arr import ArrClient, DiskSpace, HistoryEvent, MediaFile, QueueItem


@dataclass(frozen=True)
class Movie:
    id: int
    title: str
    tmdb_id: int
    year: int | None
    path: str
    monitored: bool
    has_file: bool
    file_id: int | None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Movie:
        return cls(
            id=int(raw.get("id") or 0),
            title=raw.get("title") or "",
            tmdb_id=int(raw.get("tmdbId") or 0),
            year=raw.get("year"),
            path=raw.get("path") or "",
            monitored=bool(raw.get("monitored", False)),
            has_file=bool(raw.get("hasFile", False)),
            file_id=int(raw["movieFile"]["id"]) if raw.get("movieFile") else None,
        )


class Radarr(Protocol):
    host: str
    base_url: str

    async def root_folders(self) -> list[str]: ...
    async def disk_space(self) -> list[DiskSpace]: ...
    async def queue(self) -> list[QueueItem]: ...
    async def history(self, media_id: int) -> list[HistoryEvent]: ...
    async def movies(self) -> list[Movie]: ...
    async def movie_by_tmdb(self, tmdb_id: int) -> Movie | None: ...
    async def movie_files(self, movie_id: int) -> list[MediaFile]: ...
    async def delete_movie_file(self, file_id: int) -> None: ...
    async def movies_search(self, movie_ids: list[int]) -> int: ...
    async def mark_failed(self, history_id: int) -> None: ...


class RadarrClient(ArrClient):
    service = "radarr"
    history_scope = ("movie", "movieId")

    async def movies(self) -> list[Movie]:
        return [Movie.from_api(m) for m in await self.get_json(f"{self.api}/movie")]

    async def movie_by_tmdb(self, tmdb_id: int) -> Movie | None:
        rows = await self.get_json(f"{self.api}/movie", params={"tmdbId": tmdb_id})
        return Movie.from_api(rows[0]) if rows else None

    async def movie_files(self, movie_id: int) -> list[MediaFile]:
        rows = await self.get_json(f"{self.api}/moviefile", params={"movieId": movie_id})
        return [MediaFile.from_api(r) for r in rows]

    async def delete_movie_file(self, file_id: int) -> None:
        await self.delete(f"{self.api}/moviefile/{file_id}")

    async def movies_search(self, movie_ids: list[int]) -> int:
        return await self.command("MoviesSearch", movieIds=movie_ids)


@dataclass
class FakeRadarrClient:
    host: str = "fake"
    base_url: str = ""
    roots: list[str] = field(default_factory=lambda: ["/Movies"])
    disks: list[DiskSpace] = field(default_factory=list)
    queue_items: list[QueueItem] = field(default_factory=list)
    # Download history per movie or series id, newest first.
    events: dict[int, list[HistoryEvent]] = field(default_factory=dict)
    movie_list: list[Movie] = field(default_factory=list)
    files: list[MediaFile] = field(default_factory=list)
    failed: list[int] = field(default_factory=list)
    searched: list[list[int]] = field(default_factory=list)
    deleted: list[int] = field(default_factory=list)

    async def root_folders(self) -> list[str]:
        return list(self.roots)

    async def disk_space(self) -> list[DiskSpace]:
        return list(self.disks)

    async def queue(self) -> list[QueueItem]:
        return list(self.queue_items)

    async def history(self, media_id: int) -> list[HistoryEvent]:
        return list(self.events.get(media_id, []))

    async def movies(self) -> list[Movie]:
        return list(self.movie_list)

    async def movie_by_tmdb(self, tmdb_id: int) -> Movie | None:
        return next((m for m in self.movie_list if m.tmdb_id == tmdb_id), None)

    async def movie_files(self, movie_id: int) -> list[MediaFile]:
        return [f for f in self.files if f.media_id == movie_id]

    async def delete_movie_file(self, file_id: int) -> None:
        self.deleted.append(file_id)
        self.files = [f for f in self.files if f.id != file_id]

    async def movies_search(self, movie_ids: list[int]) -> int:
        self.searched.append(list(movie_ids))
        return len(self.searched)

    async def mark_failed(self, history_id: int) -> None:
        self.failed.append(history_id)
