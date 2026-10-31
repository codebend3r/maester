"""raven: the suite's own library and player, read the way any visitor's browser reads it.

sparrow sends no PIN, so a library raven keeps locked stays out of every answer.

- `GET /api/home/search?q=`: every library holding a title that matches by
  title, one shelf each: `{libraryId, type: "media", media: [...]}` for a
  movie library, `{libraryId, type: "shows", shows: [...]}` for a show one
- `GET /api/libraries`: each library's id and name

A title opens in raven at `/movies/{item}?library={library}` or
`/shows/{item}?library={library}`, the item being raven's matched movie or
show, so the link shows that library's copy.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal, Protocol

from sparrow.clients.base import ClientError, Downable, HttpClient

SEARCH_PATH = "/api/home/search"
LIBRARIES_PATH = "/api/libraries"
SHELF_TYPES = {"media": "media", "shows": "shows"}
PAGES = {"movie": "movies", "show": "shows"}

TitleKind = Literal["movie", "show"]


def quality_of(width: int | None) -> str | None:
    """The resolution a file's width means, the way release names say it."""
    if not width:
        return None
    if width >= 3000:
        return "4K"
    if width >= 1800:
        return "1080p"
    if width >= 1200:
        return "720p"
    return "SD"


@dataclass(frozen=True)
class RavenTitle:
    """One library's copy of a title: a movie's file, or a show and its episodes."""

    library_id: int
    library: str
    kind: TitleKind
    title: str
    year: int | None
    item_id: int | None  # raven's matched movie or show; None for an unmatched file
    quality: str | None = None
    hdr: bool = False
    versions: int = 1
    episodes: int | None = None

    def link(self, base_url: str) -> str | None:
        if self.item_id is None:
            return None
        return f"{base_url}/{PAGES[self.kind]}/{self.item_id}?library={self.library_id}"

    def logo_url(self, base_url: str) -> str | None:
        """The title's logo (its name as the poster sets it), as raven serves it."""
        if self.item_id is None:
            return None
        return f"{base_url}/api/items/{self.item_id}/images/logo"

    @classmethod
    def from_movie(cls, raw: dict[str, Any], library: str) -> RavenTitle:
        item = raw.get("item") or {}
        return cls(
            library_id=int(raw["libraryId"]),
            library=library,
            kind="movie",
            title=item.get("title") or raw["title"],
            year=item.get("year") or raw.get("year"),
            item_id=item.get("id"),
            quality=quality_of(raw.get("width")),
            hdr=bool(raw.get("hdr")),
            versions=int(raw.get("versions") or 1),
        )

    @classmethod
    def from_show(cls, raw: dict[str, Any], library_id: int, library: str) -> RavenTitle:
        show = raw["show"]
        return cls(
            library_id=library_id,
            library=library,
            kind="show",
            title=show["title"],
            year=show.get("year"),
            item_id=show.get("id"),
            episodes=raw.get("episodes"),
        )


def titles_from(shelves: list[dict[str, Any]], names: dict[int, str]) -> list[RavenTitle]:
    found: list[RavenTitle] = []
    for shelf in shelves:
        library_id = int(shelf["libraryId"])
        name = names.get(library_id, f"library {library_id}")
        if shelf.get("type") == SHELF_TYPES["shows"]:
            found += [RavenTitle.from_show(s, library_id, name) for s in shelf.get("shows", [])]
        else:
            found += [RavenTitle.from_movie(m, name) for m in shelf.get("media", [])]
    return found


class Raven(Protocol):
    base_url: str

    async def search(self, query: str) -> list[RavenTitle]: ...

    async def ping(self) -> None: ...


class RavenClient(HttpClient):
    service = "raven"
    health_path = "/api/health"

    async def search(self, query: str) -> list[RavenTitle]:
        """Every unlocked library's titles matching `query`, with the library's name."""
        shelves, libraries = await asyncio.gather(
            self.get_json(SEARCH_PATH, params={"q": query}), self.get_json(LIBRARIES_PATH)
        )
        try:
            names = {int(lib["id"]): str(lib["name"]) for lib in libraries}
            return titles_from(shelves, names)
        except (KeyError, TypeError, ValueError) as exc:
            raise ClientError(self.service, "GET", SEARCH_PATH, 200, "unexpected body") from exc


@dataclass
class FakeRavenClient(Downable):
    service: ClassVar[str] = "raven"

    titles: list[RavenTitle] = field(default_factory=list)
    base_url: str = "http://raven.test"

    async def search(self, query: str) -> list[RavenTitle]:
        self.refuse_if_down(SEARCH_PATH)
        wanted = query.strip().lower()
        return [t for t in self.titles if wanted and wanted in t.title.lower()]
