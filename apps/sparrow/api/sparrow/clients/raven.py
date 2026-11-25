"""raven: the suite's own library and player, and who is signed in to the suite.

sparrow reads raven as the person asking: a client bound to their Supabase
access token (`as_viewer`) sends it as the bearer, so raven's own rules for
that account apply, the libraries it may see and its own play history and
streams included. sparrow holds no token of its own, and keeps none past the
request. Without a token (the sandbox, against a raven with accounts off) a
request is the browser's.

- `GET /api/me`: whose a token is, `{id, email, status, isOwner}`; 401 for a
  token raven doesn't accept
- `GET /api/auth/config`: where the suite signs in (Supabase's URL and key),
  which sparrow's page reads through sparrow
- `GET /api/home/search?q=`: every library holding a title that matches by
  title, one shelf each: `{libraryId, type: "media", media: [...]}` for a
  movie library, `{libraryId, type: "shows", shows: [...]}` for a show one
- `GET /api/libraries`: each library's id, name and settings (its kind, and
  whether it is locked)
- `GET /api/libraries/{id}/media?sort=year-new` and `/shows?sort=year-new`: a
  movie or show library's titles, the latest released first
- `GET /api/people?q=`: the people whose name holds `q`, each with how many
  of raven's titles they are credited on (an exact name first, then the most
  credited); people on no title the viewer sees stay out
- `GET /api/people/{id}`: a person, what TMDB says of them, the titles in
  raven they are credited on (`credits`), and their whole TMDB filmography
  (`filmography`, once `ready`), each entry with raven's item when it holds it
- `GET /api/items/{id}`: a movie, show or episode: its TMDB id and every
  file that is it (`versions`), with each file's resolution, codec and bitrate
- `GET /api/history?show=video`: the viewer's own plays, newest first
- `GET /api/streams/mine`: the viewer's own live streams; `GET /api/streams`
  is everyone's, for raven's owner alone

A title opens in raven at `/movies/{item}?library={library}` or
`/shows/{item}?library={library}`, the item being raven's matched movie or
show, so the link shows that library's copy.
"""

from __future__ import annotations

import asyncio
import copy
import enum
import ipaddress
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal, Protocol

from sparrow.clients.base import ClientError, Downable, HttpClient

SEARCH_PATH = "/api/home/search"
LIBRARIES_PATH = "/api/libraries"
PEOPLE_PATH = "/api/people"
ME_PATH = "/api/me"
AUTH_CONFIG_PATH = "/api/auth/config"
ITEMS_PATH = "/api/items"
HISTORY_PATH = "/api/history"
STREAMS_PATH = "/api/streams"
MY_STREAMS_PATH = "/api/streams/mine"
# raven's history narrowed to videos, as its `show` query names them.
HISTORY_VIDEOS = {"show": "video"}
SIGNED_OUT = 401
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


UHD_WIDTH = 3000
CODEC_NAMES = {"h264": "H.264", "hevc": "HEVC", "av1": "AV1", "vp9": "VP9", "mpeg4": "MPEG-4"}


class MemberStatus(enum.StrEnum):
    """Where an account stands with raven's owner."""

    PENDING = "pending"
    APPROVED = "approved"
    REVOKED = "revoked"


@dataclass(frozen=True)
class RavenAccount:
    """A signed-in person, as raven's `/api/me` has them: a Supabase account."""

    id: str
    email: str
    status: MemberStatus
    is_owner: bool

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> RavenAccount:
        return cls(
            id=str(raw["id"]),
            email=str(raw["email"]),
            status=MemberStatus(raw["status"]),
            is_owner=bool(raw["isOwner"]),
        )


def _kbps(bits_per_second: Any) -> int | None:
    return round(bits_per_second / 1000) if isinstance(bits_per_second, int | float) else None


@dataclass(frozen=True)
class RavenFile:
    """One file raven holds: what it plays like, as raven probed it."""

    id: int
    title: str  # the movie or episode it is, as raven names it, else the file's own title
    width: int | None
    video_codec: str | None  # ffprobe's name: "h264", "hevc", "av1"
    hdr: bool
    dolby_vision: int | None  # the Dolby Vision profile; None without it, or not probed
    bitrate_kbps: int | None  # across the whole file; None until probed
    size_bytes: int
    variant: str | None = None  # what sets a split movie card apart: "Final Cut"

    @property
    def is_4k(self) -> bool:
        return (self.width or 0) >= UHD_WIDTH

    @property
    def name(self) -> str:
        """How a friend would name it: "4K HDR (HEVC)", "1080p (H.264)", "Final Cut, 4K"."""
        quality = quality_of(self.width) or "unknown resolution"
        picture = " Dolby Vision" if self.dolby_vision else " HDR" if self.hdr else ""
        codec = CODEC_NAMES.get(self.video_codec or "", (self.video_codec or "").upper())
        named = f"{quality}{picture}" + (f" ({codec})" if codec else "")
        return f"{self.variant}, {named}" if self.variant else named

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> RavenFile:
        item = raw.get("item") or {}
        return cls(
            id=int(raw["id"]),
            title=str(item.get("title") or raw["title"]),
            width=raw.get("width"),
            video_codec=raw.get("videoCodec"),
            hdr=bool(raw.get("hdr")),
            dolby_vision=raw.get("dolbyVisionProfile"),
            bitrate_kbps=_kbps(raw.get("bitrate")),
            size_bytes=int(raw.get("size") or 0),
            variant=raw.get("variant"),
        )


class PlaybackMode(enum.StrEnum):
    """How raven sends a file: as it is, repackaged (remuxed), or converted (transcoded)."""

    DIRECT = "direct"
    REMUX = "remux"
    TRANSCODE = "transcode"


# The home network's addresses: the private ranges, IPv4's and IPv6's, and link-local.
HOME_NETWORKS = tuple(
    ipaddress.ip_network(n)
    for n in (
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "169.254.0.0/16",
        "fc00::/7",
        "fe80::/10",
    )
)
# raven's word for a live stream that plays, rather than one a download keeps.
PLAY_PURPOSE = "play"


@dataclass(frozen=True)
class LiveStream:
    """A video raven is sending one browser or device right now."""

    file: RavenFile
    item_id: int | None  # the movie or episode it is, once matched
    library: str
    mode: PlaybackMode
    device: str  # the client's own word for itself, from its User-Agent
    browser: str
    address: str  # where its requests come from
    send_kbps: int | None  # what raven sent over the last few seconds; None until measured
    quality: str | None  # the size a transcode was asked for (raven's key); None otherwise

    @property
    def remote(self) -> bool:
        """Away from home: its requests come from outside the home network."""
        try:
            address = ipaddress.ip_address(self.address)
        except ValueError:  # an address raven couldn't read is taken as away
            return True
        return not (address.is_loopback or any(address in net for net in HOME_NETWORKS))

    @property
    def player(self) -> str:
        return " on ".join(part for part in (self.browser, self.device) if part) or "a player"

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> LiveStream:
        media = raw["media"]
        return cls(
            file=RavenFile.from_api(media),
            item_id=(media.get("item") or {}).get("id"),
            library=str(raw.get("libraryName") or ""),
            mode=PlaybackMode(raw["mode"]),
            device=str(raw.get("device") or ""),
            browser=str(raw.get("browser") or ""),
            address=str(raw.get("address") or ""),
            send_kbps=_kbps(raw.get("sendRate")),
            quality=raw.get("quality"),
        )


ItemKind = Literal["movie", "show", "season", "episode"]


@dataclass(frozen=True)
class RavenItem:
    """A movie, show or episode raven matched: its TMDB id and every file that is it."""

    id: int
    kind: ItemKind
    title: str
    year: int | None
    tmdb_id: int | None  # None for a TV movie, which TMDB numbers apart
    files: tuple[RavenFile, ...]

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> RavenItem:
        tmdb = str(raw.get("tmdbId") or "")
        return cls(
            id=int(raw["id"]),
            kind=raw["type"],
            title=str(raw["title"]),
            year=raw.get("year"),
            tmdb_id=int(tmdb) if tmdb.isdigit() else None,
            files=tuple(RavenFile.from_api(f) for f in raw.get("versions") or []),
        )


@dataclass(frozen=True)
class Played:
    """One sitting with a video in the viewer's history: a movie (or other video) or an
    episode, the file played, and when it last played."""

    media_id: int
    played_at: str  # ISO 8601
    library: str
    title: str  # the video's, or the episode's
    item_id: int | None  # the movie or episode, once matched
    show: str | None = None  # an episode's show, and its item
    show_id: int | None = None
    season: int | None = None
    episode: int | None = None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Played | None:
        """A history entry, or None for a track."""
        played = raw["played"]
        common: dict[str, Any] = {
            "media_id": int(raw["mediaId"]),
            "played_at": str(raw["lastPlayedAt"]),
            "library": str(raw.get("libraryName") or ""),
            "title": str(played["title"]),
            "item_id": played.get("itemId"),
        }
        match played["kind"]:
            case "video":
                return cls(**common)
            case "episode":
                return cls(
                    **common,
                    show=str(played["show"]),
                    show_id=played.get("showId"),
                    season=played.get("season"),
                    episode=played.get("episode"),
                )
        return None


def _streams(raw: list[dict[str, Any]]) -> list[LiveStream]:
    """The plays among raven's live streams; a download being kept isn't watched."""
    return [LiveStream.from_api(s) for s in raw if s.get("purpose") == PLAY_PURPOSE]


class Raven(Protocol):
    """raven as one viewer reads it."""

    base_url: str

    async def search(self, query: str) -> list[RavenTitle]: ...

    async def newest(self, kind: TitleKind) -> list[RavenTitle]: ...

    async def people(self, query: str) -> list[PersonMatch]: ...

    async def person(self, person_id: int) -> RavenPerson: ...

    async def item(self, item_id: int) -> RavenItem: ...

    async def history(self, limit: int) -> list[Played]: ...

    async def my_streams(self) -> list[LiveStream]: ...

    async def streams(self) -> list[LiveStream]: ...


class RavenServer(Protocol):
    """raven itself: who a token is, where the suite signs in, and a reader per viewer."""

    base_url: str

    def as_viewer(self, token: str | None) -> Raven: ...

    async def me(self, token: str) -> RavenAccount | None: ...

    async def auth_config(self) -> dict[str, Any]: ...

    async def ping(self) -> None: ...


def _bearer(token: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


class RavenClient(HttpClient):
    service = "raven"
    health_path = "/api/health"

    def __init__(self, base_url: str, *, token: str | None = None, **kwargs: Any):
        super().__init__(base_url, **kwargs)
        self.token = token

    def as_viewer(self, token: str | None) -> RavenClient:
        """This client as `token`'s holder, on the same connections."""
        viewer = copy.copy(self)
        viewer.token = token
        viewer._client = self.client
        return viewer

    async def _read(self, path: str, params: dict[str, Any] | None = None) -> Any:
        return await self.get_json(path, params=params, headers=_bearer(self.token))

    def _parse[T](self, path: str, parse: Callable[[Any], T], raw: Any) -> T:
        """`raw` as `parse` reads it; a body it can't read is raven's error, not sparrow's."""
        try:
            return parse(raw)
        except (KeyError, TypeError, ValueError) as exc:
            raise ClientError(self.service, "GET", path, 200, "unexpected body") from exc

    async def _parsed[T](self, path: str, parse: Callable[[Any], T], **params: Any) -> T:
        return self._parse(path, parse, await self._read(path, params or None))

    async def me(self, token: str) -> RavenAccount | None:
        """Whose `token` is; None when raven doesn't accept it. Anything else raises."""
        try:
            raw = await self.get_json(ME_PATH, headers=_bearer(token))
        except ClientError as exc:
            if exc.status == SIGNED_OUT:
                return None
            raise
        return self._parse(ME_PATH, RavenAccount.from_api, raw)

    async def auth_config(self) -> dict[str, Any]:
        raw = await self.get_json(AUTH_CONFIG_PATH)
        if not isinstance(raw, dict) or "state" not in raw:
            raise ClientError(self.service, "GET", AUTH_CONFIG_PATH, 200, "unexpected body")
        return raw

    async def search(self, query: str) -> list[RavenTitle]:
        """Every library the viewer sees with titles matching `query`, with its name."""
        shelves, libraries = await asyncio.gather(
            self._read(SEARCH_PATH, {"q": query}), self._read(LIBRARIES_PATH)
        )

        def titles(found: list[dict[str, Any]]) -> list[RavenTitle]:
            return titles_from(found, {int(lib["id"]): str(lib["name"]) for lib in libraries})

        return self._parse(SEARCH_PATH, titles, shelves)

    async def newest(self, kind: TitleKind) -> list[RavenTitle]:
        """Each unlocked movie (or show) library's titles, the latest released first."""

        def unlocked(libraries: list[dict[str, Any]]) -> list[tuple[int, str]]:
            return [
                (int(lib["id"]), str(lib["name"]))
                for lib in libraries
                if lib["settings"]["kind"] in KINDS[kind] and not lib["settings"]["locked"]
            ]

        wanted = await self._parsed(LIBRARIES_PATH, unlocked)
        listings = await asyncio.gather(
            *(
                self._read(f"{LIBRARIES_PATH}/{library_id}/{LISTINGS[kind]}", {"sort": NEWEST_SORT})
                for library_id, _ in wanted
            )
        )

        def titles(read: list[Any]) -> list[RavenTitle]:
            return [
                title
                for (library_id, name), listing in zip(wanted, read, strict=True)
                for title in _listed(kind, listing, library_id, name)
            ]

        return self._parse(LIBRARIES_PATH, titles, listings)

    async def people(self, query: str) -> list[PersonMatch]:
        """The people whose name holds `query` and who are on a title the viewer sees."""

        def matches(found: list[dict[str, Any]]) -> list[PersonMatch]:
            return [PersonMatch(int(p["id"]), str(p["name"]), int(p["titles"])) for p in found]

        return await self._parsed(PEOPLE_PATH, matches, q=query)

    async def person(self, person_id: int) -> RavenPerson:
        return await self._parsed(f"{PEOPLE_PATH}/{person_id}", person_from)

    async def item(self, item_id: int) -> RavenItem:
        return await self._parsed(f"{ITEMS_PATH}/{item_id}", RavenItem.from_api)

    async def history(self, limit: int) -> list[Played]:
        """The viewer's latest plays of videos, newest first."""

        def entries(page: dict[str, Any]) -> list[Played]:
            return [p for p in map(Played.from_api, page["entries"]) if p is not None]

        return await self._parsed(HISTORY_PATH, entries, limit=limit, **HISTORY_VIDEOS)

    async def my_streams(self) -> list[LiveStream]:
        return await self._parsed(MY_STREAMS_PATH, _streams)

    async def streams(self) -> list[LiveStream]:
        """Everyone's live streams: raven answers only its owner."""
        return await self._parsed(STREAMS_PATH, _streams)


@dataclass
class FakeRavenClient(Downable):
    service: ClassVar[str] = "raven"

    titles: list[RavenTitle] = field(default_factory=list)
    persons: list[RavenPerson] = field(default_factory=list)
    items: dict[int, RavenItem] = field(default_factory=dict)
    plays: list[Played] = field(default_factory=list)  # the viewer's, newest first
    live: list[LiveStream] = field(default_factory=list)  # everyone's
    mine: list[LiveStream] = field(default_factory=list)  # the viewer's own
    accounts: dict[str, RavenAccount] = field(default_factory=dict)  # by token
    config: dict[str, Any] = field(default_factory=lambda: {"state": "off"})
    base_url: str = "http://raven.test"
    # Every token raven was asked about, and every one a reader was made for, in order.
    asked: list[str] = field(default_factory=list)
    viewers: list[str | None] = field(default_factory=list)

    def as_viewer(self, token: str | None) -> FakeRavenClient:
        self.viewers.append(token)
        return self

    async def me(self, token: str) -> RavenAccount | None:
        self.refuse_if_down(ME_PATH)
        self.asked.append(token)
        return self.accounts.get(token)

    async def auth_config(self) -> dict[str, Any]:
        self.refuse_if_down(AUTH_CONFIG_PATH)
        return self.config

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

    async def item(self, item_id: int) -> RavenItem:
        path = f"{ITEMS_PATH}/{item_id}"
        self.refuse_if_down(path)
        if item_id not in self.items:
            raise ClientError(self.service, "GET", path, 404, "no such item")
        return self.items[item_id]

    async def history(self, limit: int) -> list[Played]:
        self.refuse_if_down(HISTORY_PATH)
        return self.plays[:limit]

    async def my_streams(self) -> list[LiveStream]:
        self.refuse_if_down(MY_STREAMS_PATH)
        return list(self.mine)

    async def streams(self) -> list[LiveStream]:
        self.refuse_if_down(STREAMS_PATH)
        return list(self.live)
