"""What Seerr answers with, as typed records: titles, requests, quotas, servers.

Parsing lives here (`from_api`), next to each record, so the client and the
fake share one shape. Status codes mirror Seerr's own enums.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from typing import Any

# Issue types.
ISSUE_VIDEO, ISSUE_AUDIO, ISSUE_SUBTITLE, ISSUE_OTHER = 1, 2, 3, 4
# TMDB's "anime" keyword, the id Seerr itself uses to route anime to Sonarr's
# anime settings, and TMDB's Animation genre.
ANIME_KEYWORD, ANIMATION_GENRE = 210024, 16
TMDB_POSTER = "https://image.tmdb.org/t/p/w185"


class MediaStatus(enum.IntEnum):
    """Seerr's MediaStatus: where one version (standard or 4K) of a title stands."""

    UNKNOWN = 1
    PENDING = 2
    PROCESSING = 3
    PARTIALLY_AVAILABLE = 4
    AVAILABLE = 5
    BLOCKLISTED = 6
    DELETED = 7

    @property
    def label(self) -> str:
        return _MEDIA_LABELS[self]

    @property
    def requestable(self) -> bool:
        """Nothing on the server and nothing asked for yet, so a request would add it."""
        return self in (MediaStatus.UNKNOWN, MediaStatus.DELETED)


_MEDIA_LABELS = {
    MediaStatus.UNKNOWN: "not on the server",
    MediaStatus.PENDING: "requested, waiting for approval",
    MediaStatus.PROCESSING: "requested, downloading",
    MediaStatus.PARTIALLY_AVAILABLE: "partly on the server",
    MediaStatus.AVAILABLE: "on the server",
    MediaStatus.BLOCKLISTED: "blocklisted",
    MediaStatus.DELETED: "not on the server (removed)",
}


class RequestStatus(enum.IntEnum):
    PENDING = 1
    APPROVED = 2
    DECLINED = 3
    FAILED = 4
    COMPLETED = 5

    @property
    def label(self) -> str:
        return self.name.lower()


def _year(raw: dict[str, Any]) -> int | None:
    date = raw.get("releaseDate") or raw.get("firstAirDate") or ""
    return int(date[:4]) if date[:4].isdigit() else None


def _int_or_none(value: Any) -> int | None:
    return int(value) if value not in (None, "") else None


@dataclass(frozen=True)
class SearchResult:
    tmdb_id: int
    media_type: str  # "movie" | "tv"
    title: str
    year: int | None
    overview: str
    poster_path: str | None
    status: MediaStatus
    status_4k: MediaStatus

    @property
    def poster_url(self) -> str | None:
        return f"{TMDB_POSTER}{self.poster_path}" if self.poster_path else None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> SearchResult:
        info = raw.get("mediaInfo") or {}
        return cls(
            tmdb_id=int(raw["id"]),
            media_type=raw.get("mediaType", ""),
            title=raw.get("title") or raw.get("name") or "",
            year=_year(raw),
            overview=raw.get("overview") or "",
            poster_path=raw.get("posterPath"),
            status=MediaStatus(info.get("status", MediaStatus.UNKNOWN)),
            status_4k=MediaStatus(info.get("status4k", MediaStatus.UNKNOWN)),
        )


@dataclass(frozen=True)
class ArrRef:
    """Where Seerr sent one copy of a title: its Radarr/Sonarr server, and the title's id there."""

    server_id: int
    media_id: int

    @classmethod
    def from_media(cls, media: dict[str, Any], is_4k: bool) -> ArrRef | None:
        suffix = "4k" if is_4k else ""
        server_id = media.get(f"serviceId{suffix}")
        media_id = media.get(f"externalServiceId{suffix}")
        if server_id is None or media_id is None:
            return None
        return cls(int(server_id), int(media_id))


@dataclass(frozen=True)
class Season:
    """One TMDB season of a show, with where it stands on the server."""

    number: int
    episodes: int
    status: MediaStatus
    status_4k: MediaStatus

    def status_for(self, is_4k: bool) -> MediaStatus:
        return self.status_4k if is_4k else self.status


@dataclass(frozen=True)
class MediaDetails:
    """A movie or show as Seerr describes it: TMDB facts plus the server's copies."""

    tmdb_id: int
    media_type: str
    title: str
    year: int | None
    overview: str
    status: MediaStatus
    status_4k: MediaStatus
    rating_key: str | None = None  # Plex, standard copy
    rating_key_4k: str | None = None
    arr: ArrRef | None = None  # the arr holding the standard copy, when Seerr sent it
    arr_4k: ArrRef | None = None
    tvdb_id: int | None = None
    collection_id: int | None = None
    seasons: tuple[Season, ...] = ()  # TV only; specials and unaired seasons left out
    keyword_ids: frozenset[int] = frozenset()
    genre_ids: frozenset[int] = frozenset()
    original_language: str = ""

    @property
    def display(self) -> str:
        return f"{self.title} ({self.year})" if self.year else self.title

    @property
    def seerr_anime(self) -> bool:
        """Seerr's own rule for sending a show to its anime Sonarr settings: TMDB's keyword."""
        return self.media_type == "tv" and ANIME_KEYWORD in self.keyword_ids

    @property
    def anime_by_tmdb(self) -> bool:
        """TMDB tags it anime, or it is Japanese animation."""
        return ANIME_KEYWORD in self.keyword_ids or (
            ANIMATION_GENRE in self.genre_ids and self.original_language == "ja"
        )

    def status_for(self, is_4k: bool) -> MediaStatus:
        return self.status_4k if is_4k else self.status

    def rating_key_for(self, is_4k: bool) -> str | None:
        return self.rating_key_4k if is_4k else self.rating_key

    def arr_for(self, is_4k: bool) -> ArrRef | None:
        return self.arr_4k if is_4k else self.arr

    @classmethod
    def from_api(cls, media_type: str, raw: dict[str, Any]) -> MediaDetails:
        info = raw.get("mediaInfo") or {}
        on_server = {int(s["seasonNumber"]): s for s in info.get("seasons") or []}
        seasons = []
        for tmdb_season in raw.get("seasons") or []:
            number, episodes = int(tmdb_season["seasonNumber"]), int(tmdb_season["episodeCount"])
            # What Seerr itself offers as "all seasons": no specials, nothing unaired.
            if number > 0 and episodes > 0:
                known = on_server.get(number, {})
                seasons.append(
                    Season(
                        number,
                        episodes,
                        MediaStatus(known.get("status", MediaStatus.UNKNOWN)),
                        MediaStatus(known.get("status4k", MediaStatus.UNKNOWN)),
                    )
                )
        return cls(
            tmdb_id=int(raw["id"]),
            media_type=media_type,
            title=raw.get("title") or raw.get("name") or "",
            year=_year(raw),
            overview=raw.get("overview") or "",
            status=MediaStatus(info.get("status", MediaStatus.UNKNOWN)),
            status_4k=MediaStatus(info.get("status4k", MediaStatus.UNKNOWN)),
            rating_key=info.get("ratingKey") or None,
            rating_key_4k=info.get("ratingKey4k") or None,
            arr=ArrRef.from_media(info, is_4k=False),
            arr_4k=ArrRef.from_media(info, is_4k=True),
            tvdb_id=_int_or_none(
                (raw.get("externalIds") or {}).get("tvdbId") or info.get("tvdbId")
            ),
            collection_id=_int_or_none((raw.get("collection") or {}).get("id")),
            seasons=tuple(seasons),
            keyword_ids=frozenset(int(k["id"]) for k in raw.get("keywords") or []),
            genre_ids=frozenset(int(g["id"]) for g in raw.get("genres") or []),
            original_language=raw.get("originalLanguage") or "",
        )


@dataclass(frozen=True)
class Collection:
    id: int
    name: str
    parts: tuple[SearchResult, ...]

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Collection:
        parts = (SearchResult.from_api({"mediaType": "movie", **p}) for p in raw.get("parts") or [])
        return cls(
            id=int(raw["id"]),
            name=raw.get("name") or "",
            parts=tuple(sorted(parts, key=lambda p: (p.year or 9999, p.title))),
        )


@dataclass(frozen=True)
class MediaRequest:
    id: int
    status: RequestStatus
    media_type: str
    tmdb_id: int
    is_4k: bool
    requested_by_id: int
    seasons: tuple[int, ...] = ()
    tvdb_id: int | None = None
    # Where this request's version (standard or 4K) stands, and its Plex key.
    media_status: MediaStatus = MediaStatus.UNKNOWN
    rating_key: str | None = None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> MediaRequest:
        media = raw.get("media") or {}
        is_4k = bool(raw.get("is4k", False))
        return cls(
            id=int(raw["id"]),
            status=RequestStatus(int(raw.get("status", RequestStatus.PENDING))),
            media_type=raw.get("type") or media.get("mediaType") or "",
            tmdb_id=int(media.get("tmdbId", 0)),
            is_4k=is_4k,
            requested_by_id=int((raw.get("requestedBy") or {}).get("id", 0)),
            seasons=tuple(int(s["seasonNumber"]) for s in raw.get("seasons") or []),
            tvdb_id=_int_or_none(media.get("tvdbId")),
            media_status=MediaStatus(
                media.get("status4k" if is_4k else "status", MediaStatus.UNKNOWN)
            ),
            rating_key=media.get("ratingKey4k" if is_4k else "ratingKey") or None,
        )


class Refusal(enum.StrEnum):
    QUOTA = "quota"
    PERMISSION = "permission"
    DUPLICATE = "duplicate"
    NO_SEASONS = "no_seasons"
    BLOCKLISTED = "blocklisted"


class RequestRefused(Exception):
    """Seerr said no to a request, and why."""

    def __init__(self, reason: Refusal, message: str):
        self.reason, self.message = reason, message
        super().__init__(f"{reason}: {message}")

    @classmethod
    def from_answer(cls, status: int, message: str) -> RequestRefused | None:
        """Classify Seerr's answer to POST /request; None when it is not a refusal.

        Seerr answers 403 for quota ("Movie Quota exceeded."), permission
        ("You do not have permission to make 4K movie requests.") and
        blocklisted media, 409 for a duplicate, and 202 when every season
        asked for is already on the server or requested.
        """
        if status == 409:
            return cls(Refusal.DUPLICATE, message)
        if status == 202:
            return cls(Refusal.NO_SEASONS, message)
        if status == 403:
            lowered = message.lower()
            if "quota" in lowered:
                return cls(Refusal.QUOTA, message)
            if "blocklist" in lowered:
                return cls(Refusal.BLOCKLISTED, message)
            return cls(Refusal.PERMISSION, message)
        return None


@dataclass(frozen=True)
class Quota:
    """One user's request allowance for a media type; `limit` None means unlimited."""

    limit: int | None
    days: int | None
    used: int
    remaining: int | None
    restricted: bool

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Quota:
        return cls(
            limit=raw.get("limit") or None,
            days=raw.get("days") or None,
            used=int(raw.get("used") or 0),
            remaining=raw.get("remaining") if raw.get("limit") else None,
            restricted=bool(raw.get("restricted", False)),
        )


@dataclass(frozen=True)
class Quotas:
    movie: Quota
    tv: Quota

    def of(self, media_type: str) -> Quota:
        return self.movie if media_type == "movie" else self.tv


UNLIMITED = Quota(limit=None, days=None, used=0, remaining=None, restricted=False)


@dataclass(frozen=True)
class Named:
    id: int
    name: str


@dataclass(frozen=True)
class ArrServer:
    """A Radarr or Sonarr that Seerr sends approved requests to, as its settings describe it."""

    id: int
    name: str
    is_4k: bool
    is_default: bool
    url: str  # where Seerr reaches it: scheme, host, port and base path

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> ArrServer:
        scheme = "https" if raw.get("useSsl") else "http"
        base = (raw.get("baseUrl") or "").rstrip("/")
        return cls(
            id=int(raw["id"]),
            name=raw.get("name") or "",
            is_4k=bool(raw.get("is4k", False)),
            is_default=bool(raw.get("isDefault", False)),
            url=f"{scheme}://{raw['hostname']}:{int(raw['port'])}{base}",
        )


@dataclass(frozen=True)
class ServerOptions:
    """A server's profiles and tags, and the tags Seerr applies by default."""

    profiles: tuple[Named, ...]
    tags: tuple[Named, ...]
    default_tags: tuple[int, ...] = ()
    anime_tags: tuple[int, ...] = ()

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> ServerOptions:
        server = raw.get("server") or {}
        return cls(
            profiles=tuple(Named(int(p["id"]), p.get("name") or "") for p in raw["profiles"]),
            tags=tuple(Named(int(t["id"]), t.get("label") or "") for t in raw.get("tags") or []),
            default_tags=tuple(int(t) for t in server.get("activeTags") or []),
            anime_tags=tuple(int(t) for t in server.get("activeAnimeTags") or []),
        )

    def tag(self, label: str) -> Named | None:
        return next((t for t in self.tags if t.name.lower() == label.lower()), None)

    def profile(self, name: str) -> Named | None:
        return next((p for p in self.profiles if p.name.lower() == name.lower()), None)


@dataclass(frozen=True)
class Routing:
    """Where Seerr should send a request instead of its defaults."""

    server_id: int
    tags: tuple[int, ...]
    profile_id: int | None = None


@dataclass(frozen=True)
class SeerrUser:
    id: int
    email: str
    username: str
    plex_username: str

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> SeerrUser:
        return cls(
            id=int(raw["id"]),
            email=(raw.get("email") or "").lower(),
            username=raw.get("displayName") or raw.get("username") or "",
            plex_username=raw.get("plexUsername") or "",
        )
