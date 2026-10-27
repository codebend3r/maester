from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, ClassVar, Protocol

from luwin.clients.arr import Arr, ArrClient, FakeArr, RootFolder, roomy

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
class FakeRadarrClient(FakeArr):
    service: ClassVar[str] = "radarr"

    roots: list[RootFolder] = field(default_factory=lambda: roomy("/Movies"))
    movie_list: list[Movie] = field(default_factory=list)

    async def movies(self) -> list[Movie]:
        return list(self.movie_list)

    async def movie_by_tmdb(self, tmdb_id: int) -> Movie | None:
        return next((m for m in self.movie_list if m.tmdb_id == tmdb_id), None)

    async def find_id(self, details: MediaDetails) -> int | None:
        movie = await self.movie_by_tmdb(details.tmdb_id)
        return movie.id if movie else None
