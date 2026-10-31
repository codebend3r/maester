"""raven: the suite's own library and player, read the way any visitor's browser reads it.

sparrow sends no PIN, so a library raven keeps locked stays out of every answer.

- `GET /api/home/search?q=`: every library holding a title that matches by
  title, one shelf each: `{libraryId, type: "media", media: [...]}` for a
  movie library, `{libraryId, type: "shows", shows: [...]}` for a show one
- `GET /api/libraries`: each library's id, name and settings (its kind, and
  whether it is locked)
- `GET /api/libraries/{id}/media?sort=year-new` and `/shows?sort=year-new`: a
  movie or show library's titles, the latest released first

- `GET /api/people?q=`: the people whose name holds `q`, each with how many
  of raven's titles they are credited on (an exact name first, then the most
  credited); people on no title a visitor sees stay out
- `GET /api/people/{id}`: a person, what TMDB says of them, the titles in
  raven they are credited on (`credits`), and their whole TMDB filmography
  (`filmography`, once `ready`), each entry with raven's item when it holds it

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
PEOPLE_PATH = "/api/people"
SHELF_TYPES = {"media": "media", "shows": "shows"}
TitleKind = Literal["movie", "show"]
# The kind of work a credit is, as a person's filmography in raven folds TMDB's departments.
Department = Literal["acting", "directing", "writing", "producing", "crew"]
FILMOGRAPHY_READY = "ready"
FILMOGRAPHY_PENDING = "pending"
# raven's own credit jobs, folded the way its filmography folds them.
JOB_DEPARTMENTS: dict[str, Department] = {
    "cast": "acting",
    "guest": "acting",
    "director": "directing",
    "writer": "writing",
    "creator": "writing",
    "producer": "producing",
}
PAGES = {"movie": "movies", "show": "shows"}
LISTINGS = {"movie": "media", "show": "shows"}
# raven's sort for a listing by release date, the latest first.
NEWEST_SORT = "year-new"
# The library kinds whose titles are movies, and those whose titles are shows; sports,
# YouTube, other and music libraries hold neither.
KINDS: dict[TitleKind, frozenset[str]] = {
    "movie": frozenset({"movies", "animeMovies", "familyMovies", "documentaries"}),
    "show": frozenset({"shows", "animeShows", "familyShows"}),
}


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
    released: str | None = None  # the release (a show's premiere) date, YYYY-MM-DD

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
            released=item.get("released"),
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
            released=show.get("released"),
        )


@dataclass(frozen=True)
class PersonMatch:
    """A person whose name a search matched, and how many of raven's titles they are on."""

    id: int
    name: str
    titles: int


@dataclass(frozen=True)
class Part:
    """One part a person had in a title: its department and the character or job."""

    department: Department
    role: str | None = None
    is_self: bool = False  # as themselves, on a talk show and the like


@dataclass(frozen=True)
class Work:
    """A movie or show a person is credited on, with raven's item when it holds a copy."""

    kind: TitleKind
    title: str
    year: int | None
    released: str | None  # YYYY-MM-DD, or the part TMDB knows
    parts: tuple[Part, ...]
    item_id: int | None = None  # None when no library a visitor sees holds it

    def link(self, base_url: str) -> str | None:
        if self.item_id is None:
            return None
        return f"{base_url}/{PAGES[self.kind]}/{self.item_id}"

    def logo_url(self, base_url: str) -> str | None:
        if self.item_id is None:
            return None
        return f"{base_url}/api/items/{self.item_id}/images/logo"


@dataclass(frozen=True)
class RavenPerson:
    """A person as raven's page for them has it: their work, newest first.

    With TMDB's filmography read (`complete`), `works` is everything TMDB
    credits them on; without it, only the titles raven holds.
    """

    id: int
    name: str
    known_for: str | None
    works: tuple[Work, ...]
    complete: bool
    pending: bool = False  # raven is still fetching the filmography from TMDB

    def link(self, base_url: str) -> str:
        return f"{base_url}/people/{self.id}"


def _work_kind(raw: str) -> TitleKind | None:
    return "movie" if raw == "movie" else "show" if raw == "show" else None


def _held_work(item_id: int, credits: list[dict[str, Any]]) -> Work:
    """A title raven holds, from a person's credits on it there."""
    item = credits[0]["item"]
    return Work(
        kind="show" if item["type"] == "show" else "movie",
        title=item["title"],
        year=item.get("year"),
        released=item.get("released"),
        parts=tuple(Part(JOB_DEPARTMENTS.get(c["job"], "crew"), c.get("role")) for c in credits),
        item_id=item_id,
    )


def person_from(raw: dict[str, Any]) -> RavenPerson:
    """raven's person page: the TMDB filmography when it is ready, else raven's own credits."""
    profile = raw.get("profile") or {}
    filmography = raw["filmography"]
    if filmography["state"] == FILMOGRAPHY_READY:
        works = [
            Work(
                kind=kind,
                title=entry["title"],
                year=entry.get("year"),
                released=entry.get("released"),
                parts=tuple(
                    Part(c["department"], c.get("role"), bool(c.get("isSelf")))
                    for c in entry["credits"]
                ),
                item_id=(entry.get("item") or {}).get("id"),
            )
            for entry in filmography["entries"]
            if (kind := _work_kind(entry["type"])) is not None
        ]
    else:
        held: dict[int, list[dict[str, Any]]] = {}
        for credit in raw["credits"]:
            held.setdefault(int(credit["item"]["id"]), []).append(credit)
        works = [_held_work(item_id, credits) for item_id, credits in held.items()]
    return RavenPerson(
        id=int(raw["id"]),
        name=str(raw["name"]),
        known_for=profile.get("knownFor"),
        works=tuple(works),
        complete=filmography["state"] == FILMOGRAPHY_READY,
        pending=filmography["state"] == FILMOGRAPHY_PENDING,
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


def _listed(kind: TitleKind, listing: Any, library_id: int, name: str) -> list[RavenTitle]:
    """One library's listing: a show library's shows, or a movie library's files."""
    if kind == "show":
        return [RavenTitle.from_show(s, library_id, name) for s in listing["shows"]]
    return [RavenTitle.from_movie(m, name) for m in listing]


class Raven(Protocol):
    base_url: str

    async def search(self, query: str) -> list[RavenTitle]: ...

    async def newest(self, kind: TitleKind) -> list[RavenTitle]: ...

    async def people(self, query: str) -> list[PersonMatch]: ...

    async def person(self, person_id: int) -> RavenPerson: ...

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

    async def newest(self, kind: TitleKind) -> list[RavenTitle]:
        """Each unlocked movie (or show) library's titles, the latest released first."""
        libraries = await self.get_json(LIBRARIES_PATH)
        try:
            wanted = [
                (int(lib["id"]), str(lib["name"]))
                for lib in libraries
                if lib["settings"]["kind"] in KINDS[kind] and not lib["settings"]["locked"]
            ]
        except (KeyError, TypeError, ValueError) as exc:
            raise ClientError(self.service, "GET", LIBRARIES_PATH, 200, "unexpected body") from exc
        listings = await asyncio.gather(
            *(
                self.get_json(
                    f"{LIBRARIES_PATH}/{library_id}/{LISTINGS[kind]}", params={"sort": NEWEST_SORT}
                )
                for library_id, _ in wanted
            )
        )
        try:
            return [
                title
                for (library_id, name), listing in zip(wanted, listings, strict=True)
                for title in _listed(kind, listing, library_id, name)
            ]
        except (KeyError, TypeError, ValueError) as exc:
            raise ClientError(self.service, "GET", LIBRARIES_PATH, 200, "unexpected body") from exc

    async def people(self, query: str) -> list[PersonMatch]:
        """The people whose name holds `query` and who are on a title a visitor sees."""
        found = await self.get_json(PEOPLE_PATH, params={"q": query})
        try:
            return [PersonMatch(int(p["id"]), str(p["name"]), int(p["titles"])) for p in found]
        except (KeyError, TypeError, ValueError) as exc:
            raise ClientError(self.service, "GET", PEOPLE_PATH, 200, "unexpected body") from exc

    async def person(self, person_id: int) -> RavenPerson:
        path = f"{PEOPLE_PATH}/{person_id}"
        raw = await self.get_json(path)
        try:
            return person_from(raw)
        except (KeyError, TypeError, ValueError) as exc:
            raise ClientError(self.service, "GET", path, 200, "unexpected body") from exc


@dataclass
class FakeRavenClient(Downable):
    service: ClassVar[str] = "raven"

    titles: list[RavenTitle] = field(default_factory=list)
    persons: list[RavenPerson] = field(default_factory=list)
    base_url: str = "http://raven.test"

    async def search(self, query: str) -> list[RavenTitle]:
        self.refuse_if_down(SEARCH_PATH)
        wanted = query.strip().lower()
        return [t for t in self.titles if wanted and wanted in t.title.lower()]

    async def newest(self, kind: TitleKind) -> list[RavenTitle]:
        self.refuse_if_down(LIBRARIES_PATH)
        return [t for t in self.titles if t.kind == kind]

    async def people(self, query: str) -> list[PersonMatch]:
        self.refuse_if_down(PEOPLE_PATH)
        wanted = query.strip().lower()
        found = [
            PersonMatch(p.id, p.name, sum(1 for w in p.works if w.item_id is not None))
            for p in self.persons
            if wanted and wanted in p.name.lower()
        ]
        return sorted(
            (p for p in found if p.titles > 0),
            key=lambda p: (p.name.lower() != wanted, -p.titles),
        )

    async def person(self, person_id: int) -> RavenPerson:
        path = f"{PEOPLE_PATH}/{person_id}"
        self.refuse_if_down(path)
        found = next((p for p in self.persons if p.id == person_id), None)
        if found is None:
            raise ClientError(self.service, "GET", path, 404, "no such person")
        return found
