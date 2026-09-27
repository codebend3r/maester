"""Seerr (Overseerr fork): search, details, collections, requests, quotas, users, issues.

Requests are made on a friend's behalf with the `X-API-User` header so Seerr
applies that user's quotas and permissions, and the request shows under their
name rather than the bot's. When Seerr refuses a request it answers with a
status and one sentence (quota, permission, duplicate, nothing left to
request); `create_request` turns those into a typed `RequestRefused` so tools
can explain them in plain words.
"""

from __future__ import annotations

import enum
import json
from dataclasses import dataclass, field, replace
from typing import Any, Protocol

from maester.clients.base import ClientError, HttpClient

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
    def anime_by_tmdb(self) -> bool:
        """TMDB tags it anime, or it is Japanese animation."""
        return ANIME_KEYWORD in self.keyword_ids or (
            ANIMATION_GENRE in self.genre_ids and self.original_language == "ja"
        )

    def status_for(self, is_4k: bool) -> MediaStatus:
        return self.status_4k if is_4k else self.status

    def rating_key_for(self, is_4k: bool) -> str | None:
        return self.rating_key_4k if is_4k else self.rating_key

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
    """A Radarr or Sonarr that Seerr sends approved requests to."""

    id: int
    name: str
    is_4k: bool
    is_default: bool

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> ArrServer:
        return cls(
            id=int(raw["id"]),
            name=raw.get("name") or "",
            is_4k=bool(raw.get("is4k", False)),
            is_default=bool(raw.get("isDefault", False)),
        )


@dataclass(frozen=True)
class ServerOptions:
    """A server's profiles and tags, and the tags Seerr applies by default."""

    server: ArrServer
    profiles: tuple[Named, ...]
    tags: tuple[Named, ...]
    default_tags: tuple[int, ...] = ()
    anime_tags: tuple[int, ...] = ()

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> ServerOptions:
        server = raw.get("server") or {}
        return cls(
            server=ArrServer.from_api(server),
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


class Seerr(Protocol):
    async def search(self, query: str) -> list[SearchResult]: ...
    async def media_details(self, media_type: str, tmdb_id: int) -> MediaDetails: ...
    async def collection(self, collection_id: int) -> Collection: ...
    async def create_request(
        self,
        media_type: str,
        tmdb_id: int,
        *,
        as_user: int,
        is_4k: bool = False,
        seasons: list[int] | None = None,
        routing: Routing | None = None,
    ) -> MediaRequest: ...
    async def get_request(self, request_id: int) -> MediaRequest: ...
    async def list_requests(
        self, *, user_id: int | None = None, take: int = 20, filter: str = "all"
    ) -> list[MediaRequest]: ...
    async def approve_request(self, request_id: int) -> MediaRequest: ...
    async def decline_request(self, request_id: int) -> MediaRequest: ...
    async def quota(self, user_id: int) -> Quotas: ...
    async def servers(self, kind: str) -> list[ArrServer]: ...
    async def server_options(self, kind: str, server_id: int) -> ServerOptions: ...
    async def users(self) -> list[SeerrUser]: ...
    async def create_issue(
        self, media_id: int, issue_type: int, message: str, user_id: int
    ) -> int: ...


class SeerrClient(HttpClient):
    service = "seerr"

    def __init__(self, base_url: str, api_key: str, **kwargs: Any):
        super().__init__(base_url, headers={"X-Api-Key": api_key}, **kwargs)

    async def search(self, query: str) -> list[SearchResult]:
        data = await self.get_json("/api/v1/search", params={"query": query, "page": 1})
        return [
            SearchResult.from_api(r)
            for r in data.get("results", [])
            if r.get("mediaType") in ("movie", "tv")
        ]

    async def media_details(self, media_type: str, tmdb_id: int) -> MediaDetails:
        path = f"/api/v1/{'movie' if media_type == 'movie' else 'tv'}/{tmdb_id}"
        return MediaDetails.from_api(media_type, await self.get_json(path))

    async def collection(self, collection_id: int) -> Collection:
        return Collection.from_api(await self.get_json(f"/api/v1/collection/{collection_id}"))

    async def create_request(
        self,
        media_type: str,
        tmdb_id: int,
        *,
        as_user: int,
        is_4k: bool = False,
        seasons: list[int] | None = None,
        routing: Routing | None = None,
    ) -> MediaRequest:
        body: dict[str, Any] = {"mediaType": media_type, "mediaId": tmdb_id, "is4k": is_4k}
        if media_type == "tv":
            body["seasons"] = seasons if seasons else "all"
        if routing is not None:
            body["serverId"] = routing.server_id
            body["tags"] = list(routing.tags)
            if routing.profile_id is not None:
                body["profileId"] = routing.profile_id
        path = "/api/v1/request"
        try:
            response = await self.request(
                "POST", path, json=body, headers={"X-API-User": str(as_user)}
            )
        except ClientError as exc:
            refused = RequestRefused.from_answer(exc.status or 0, _message(exc.detail))
            if refused is None:
                raise
            raise refused from exc
        raw = self._decode(response, path)
        if refused := RequestRefused.from_answer(response.status_code, raw.get("message", "")):
            raise refused
        return MediaRequest.from_api(raw)

    async def get_request(self, request_id: int) -> MediaRequest:
        return MediaRequest.from_api(await self.get_json(f"/api/v1/request/{request_id}"))

    async def list_requests(
        self, *, user_id: int | None = None, take: int = 20, filter: str = "all"
    ) -> list[MediaRequest]:
        params: dict[str, Any] = {"take": take, "sort": "added", "filter": filter}
        if user_id is not None:
            params["requestedBy"] = user_id
        data = await self.get_json("/api/v1/request", params=params)
        return [MediaRequest.from_api(r) for r in data.get("results", [])]

    async def approve_request(self, request_id: int) -> MediaRequest:
        return MediaRequest.from_api(await self.post_json(f"/api/v1/request/{request_id}/approve"))

    async def decline_request(self, request_id: int) -> MediaRequest:
        return MediaRequest.from_api(await self.post_json(f"/api/v1/request/{request_id}/decline"))

    async def quota(self, user_id: int) -> Quotas:
        data = await self.get_json(f"/api/v1/user/{user_id}/quota")
        return Quotas(Quota.from_api(data.get("movie") or {}), Quota.from_api(data.get("tv") or {}))

    async def servers(self, kind: str) -> list[ArrServer]:
        return [ArrServer.from_api(s) for s in await self.get_json(f"/api/v1/service/{kind}")]

    async def server_options(self, kind: str, server_id: int) -> ServerOptions:
        return ServerOptions.from_api(await self.get_json(f"/api/v1/service/{kind}/{server_id}"))

    async def users(self) -> list[SeerrUser]:
        data = await self.get_json("/api/v1/user", params={"take": 500})
        return [SeerrUser.from_api(u) for u in data.get("results", [])]

    async def create_issue(self, media_id: int, issue_type: int, message: str, user_id: int) -> int:
        body = {"issueType": issue_type, "message": message, "mediaId": media_id, "userId": user_id}
        return int((await self.post_json("/api/v1/issue", body))["id"])


def _message(detail: str) -> str:
    """The sentence in a Seerr error body (`{"message": "..."}`), or the body itself."""
    try:
        return str(json.loads(detail).get("message") or detail)
    except (ValueError, AttributeError):
        return detail


@dataclass
class FakeSeerrClient:
    results: list[SearchResult] = field(default_factory=list)
    details: dict[tuple[str, int], MediaDetails] = field(default_factory=dict)
    collections: dict[int, Collection] = field(default_factory=dict)
    user_list: list[SeerrUser] = field(default_factory=list)
    requests: list[MediaRequest] = field(default_factory=list)
    quotas: dict[int, Quotas] = field(default_factory=dict)
    server_list: dict[str, list[ServerOptions]] = field(default_factory=dict)
    # A refusal to raise for a TMDB id, the way Seerr would answer.
    refusals: dict[int, RequestRefused] = field(default_factory=dict)
    routed: dict[int, Routing] = field(default_factory=dict)
    issues: list[dict[str, Any]] = field(default_factory=list)
    auto_approve: bool = False

    async def search(self, query: str) -> list[SearchResult]:
        q = query.lower()
        return [r for r in self.results if q in r.title.lower()]

    async def media_details(self, media_type: str, tmdb_id: int) -> MediaDetails:
        try:
            return self.details[(media_type, tmdb_id)]
        except KeyError:
            raise ClientError("seerr", "GET", f"/api/v1/{media_type}/{tmdb_id}", 404, "") from None

    async def collection(self, collection_id: int) -> Collection:
        return self.collections[collection_id]

    async def create_request(
        self,
        media_type: str,
        tmdb_id: int,
        *,
        as_user: int,
        is_4k: bool = False,
        seasons: list[int] | None = None,
        routing: Routing | None = None,
    ) -> MediaRequest:
        if tmdb_id in self.refusals:
            raise self.refusals[tmdb_id]
        known = self.details.get((media_type, tmdb_id))
        req = MediaRequest(
            id=len(self.requests) + 1,
            status=RequestStatus.APPROVED if self.auto_approve else RequestStatus.PENDING,
            media_type=media_type,
            tmdb_id=tmdb_id,
            is_4k=is_4k,
            requested_by_id=as_user,
            seasons=tuple(seasons or ()),
            tvdb_id=known.tvdb_id if known else None,
            media_status=MediaStatus.PROCESSING if self.auto_approve else MediaStatus.PENDING,
        )
        self.requests.append(req)
        if routing is not None:
            self.routed[req.id] = routing
        return req

    async def get_request(self, request_id: int) -> MediaRequest:
        return next(r for r in self.requests if r.id == request_id)

    async def list_requests(
        self, *, user_id: int | None = None, take: int = 20, filter: str = "all"
    ) -> list[MediaRequest]:
        rows = [r for r in self.requests if user_id is None or r.requested_by_id == user_id]
        if filter == "unavailable":
            rows = [
                r
                for r in rows
                if r.status in (RequestStatus.PENDING, RequestStatus.APPROVED)
                and r.media_status != MediaStatus.AVAILABLE
            ]
        return rows[-take:]

    async def approve_request(self, request_id: int) -> MediaRequest:
        return self._set_status(request_id, RequestStatus.APPROVED)

    async def decline_request(self, request_id: int) -> MediaRequest:
        return self._set_status(request_id, RequestStatus.DECLINED)

    def _set_status(self, request_id: int, status: RequestStatus) -> MediaRequest:
        for i, r in enumerate(self.requests):
            if r.id == request_id:
                self.requests[i] = replace(r, status=status)
                return self.requests[i]
        raise KeyError(request_id)

    async def quota(self, user_id: int) -> Quotas:
        return self.quotas.get(user_id, Quotas(UNLIMITED, UNLIMITED))

    async def servers(self, kind: str) -> list[ArrServer]:
        return [o.server for o in self.server_list.get(kind, [])]

    async def server_options(self, kind: str, server_id: int) -> ServerOptions:
        return next(o for o in self.server_list[kind] if o.server.id == server_id)

    async def users(self) -> list[SeerrUser]:
        return list(self.user_list)

    async def create_issue(self, media_id: int, issue_type: int, message: str, user_id: int) -> int:
        self.issues.append(
            {
                "id": len(self.issues) + 1,
                "mediaId": media_id,
                "issueType": issue_type,
                "message": message,
                "userId": user_id,
            }
        )
        return self.issues[-1]["id"]
