from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, ClassVar, Protocol

from luwin.clients.arr import (
    Arr,
    ArrClient,
    DiskSpace,
    HistoryEvent,
    MediaFile,
    QueueItem,
    RootFolder,
)
from luwin.clients.base import Downable

if TYPE_CHECKING:
    from luwin.clients.seerr import MediaDetails


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


class Radarr(Arr, Protocol):
    async def movies(self) -> list[Movie]: ...
    async def movie_by_tmdb(self, tmdb_id: int) -> Movie | None: ...


class RadarrClient(ArrClient):
    service = "radarr"
    history_scope = ("movie", "movieId")
    queue_includes = ("includeUnknownMovieItems", "includeMovie")
    file_scope = ("moviefile", "movieId")
    search_command = ("MoviesSearch", "movieIds")

    async def movies(self) -> list[Movie]:
        return [Movie.from_api(m) for m in await self.get_json(f"{self.api}/movie")]

    async def movie_by_tmdb(self, tmdb_id: int) -> Movie | None:
        rows = await self.get_json(f"{self.api}/movie", params={"tmdbId": tmdb_id})
        return Movie.from_api(rows[0]) if rows else None

    async def find_id(self, details: MediaDetails) -> int | None:
        """The movie's id here, by its TMDB id; None when this Radarr hasn't it."""
        movie = await self.movie_by_tmdb(details.tmdb_id)
        return movie.id if movie else None


@dataclass
class FakeRadarrClient(Downable):
    service: ClassVar[str] = "radarr"

    host: str = "fake"
    base_url: str = ""
    # A fake arr has room unless a test says otherwise: 8 of 16 TB free.
    roots: list[RootFolder] = field(
        default_factory=lambda: [RootFolder("/Movies", 8_000_000_000_000, 16_000_000_000_000)]
    )
    disks: list[DiskSpace] = field(default_factory=list)
    queue_items: list[QueueItem] = field(default_factory=list)
    # Download history per movie or series id, newest first.
    events: dict[int, list[HistoryEvent]] = field(default_factory=dict)
    movie_list: list[Movie] = field(default_factory=list)
    file_list: list[MediaFile] = field(default_factory=list)
    failed: list[int] = field(default_factory=list)
    removed: list[int] = field(default_factory=list)  # queue ids, blocklisted
    searched: list[list[int]] = field(default_factory=list)
    deleted: list[int] = field(default_factory=list)

    async def root_folders(self) -> list[RootFolder]:
        self.refuse_if_down("/api/v3/rootfolder")
        return list(self.roots)

    async def disk_space(self) -> list[DiskSpace]:
        self.refuse_if_down("/api/v3/diskspace")
        return list(self.disks)

    async def queue(self) -> list[QueueItem]:
        self.refuse_if_down("/api/v3/queue")
        return list(self.queue_items)

    async def remove_from_queue(self, queue_id: int, *, blocklist: bool = True) -> None:
        self.refuse_if_down(f"/api/v3/queue/{queue_id}")
        gone = next(q for q in self.queue_items if q.id == queue_id)
        self.removed.append(queue_id)
        # A download goes with every record of it (a season pack is one per episode).
        self.queue_items = [q for q in self.queue_items if q.download_id != gone.download_id]

    async def history(self, media_id: int) -> list[HistoryEvent]:
        return list(self.events.get(media_id, []))

    async def movies(self) -> list[Movie]:
        return list(self.movie_list)

    async def movie_by_tmdb(self, tmdb_id: int) -> Movie | None:
        return next((m for m in self.movie_list if m.tmdb_id == tmdb_id), None)

    async def find_id(self, details: MediaDetails) -> int | None:
        movie = await self.movie_by_tmdb(details.tmdb_id)
        return movie.id if movie else None

    async def files(self, media_id: int) -> list[MediaFile]:
        return [f for f in self.file_list if f.media_id == media_id]

    async def delete_file(self, file_id: int) -> None:
        self.deleted.append(file_id)
        self.file_list = [f for f in self.file_list if f.id != file_id]

    async def search(self, ids: list[int]) -> int:
        self.searched.append(list(ids))
        return len(self.searched)

    async def mark_failed(self, history_id: int) -> None:
        self.failed.append(history_id)
