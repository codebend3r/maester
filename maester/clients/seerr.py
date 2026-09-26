"""Seerr (Overseerr fork): search, requests, users and issues.

Requests are made on a friend's behalf with the `X-API-User` header so Seerr
applies that user's quotas and permissions, and the request shows under their
name rather than the bot's.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from maester.clients.base import HttpClient

# Seerr media status codes (MediaStatus enum).
STATUS_UNKNOWN, STATUS_PENDING, STATUS_PROCESSING, STATUS_PARTIAL, STATUS_AVAILABLE = 1, 2, 3, 4, 5
# Request status codes.
REQUEST_PENDING, REQUEST_APPROVED, REQUEST_DECLINED = 1, 2, 3
# Issue types.
ISSUE_VIDEO, ISSUE_AUDIO, ISSUE_SUBTITLE, ISSUE_OTHER = 1, 2, 3, 4


@dataclass(frozen=True)
class SearchResult:
    tmdb_id: int
    media_type: str  # "movie" | "tv"
    title: str
    year: int | None
    overview: str
    poster_path: str | None
    status: int  # MediaStatus, STATUS_UNKNOWN when not in the library
    status_4k: int

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> SearchResult:
        media_type = raw.get("mediaType", "")
        date = raw.get("releaseDate") or raw.get("firstAirDate") or ""
        info = raw.get("mediaInfo") or {}
        return cls(
            tmdb_id=int(raw["id"]),
            media_type=media_type,
            title=raw.get("title") or raw.get("name") or "",
            year=int(date[:4]) if date[:4].isdigit() else None,
            overview=raw.get("overview") or "",
            poster_path=raw.get("posterPath"),
            status=int(info.get("status", STATUS_UNKNOWN)),
            status_4k=int(info.get("status4k", STATUS_UNKNOWN)),
        )


@dataclass(frozen=True)
class MediaRequest:
    id: int
    status: int
    media_type: str
    tmdb_id: int
    is_4k: bool
    requested_by_id: int
    seasons: tuple[int, ...] = ()

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> MediaRequest:
        media = raw.get("media") or {}
        return cls(
            id=int(raw["id"]),
            status=int(raw.get("status", 0)),
            media_type=raw.get("type") or media.get("mediaType") or "",
            tmdb_id=int(media.get("tmdbId", 0)),
            is_4k=bool(raw.get("is4k", False)),
            requested_by_id=int((raw.get("requestedBy") or {}).get("id", 0)),
            seasons=tuple(int(s["seasonNumber"]) for s in raw.get("seasons") or []),
        )


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
    async def create_request(
        self,
        media_type: str,
        tmdb_id: int,
        *,
        is_4k: bool = False,
        seasons: list[int] | None = None,
        as_user: int | None = None,
    ) -> MediaRequest: ...
    async def list_requests(
        self, *, user_id: int | None = None, take: int = 20
    ) -> list[MediaRequest]: ...
    async def approve_request(self, request_id: int) -> MediaRequest: ...
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

    async def create_request(
        self,
        media_type: str,
        tmdb_id: int,
        *,
        is_4k: bool = False,
        seasons: list[int] | None = None,
        as_user: int | None = None,
    ) -> MediaRequest:
        body: dict[str, Any] = {"mediaType": media_type, "mediaId": tmdb_id, "is4k": is_4k}
        if media_type == "tv":
            body["seasons"] = seasons if seasons else "all"
        headers = {"X-API-User": str(as_user)} if as_user is not None else {}
        return MediaRequest.from_api(await self.post_json("/api/v1/request", body, headers=headers))

    async def list_requests(
        self, *, user_id: int | None = None, take: int = 20
    ) -> list[MediaRequest]:
        params: dict[str, Any] = {"take": take, "sort": "added", "filter": "all"}
        if user_id is not None:
            params["requestedBy"] = user_id
        data = await self.get_json("/api/v1/request", params=params)
        return [MediaRequest.from_api(r) for r in data.get("results", [])]

    async def approve_request(self, request_id: int) -> MediaRequest:
        return MediaRequest.from_api(await self.post_json(f"/api/v1/request/{request_id}/approve"))

    async def users(self) -> list[SeerrUser]:
        data = await self.get_json("/api/v1/user", params={"take": 500})
        return [SeerrUser.from_api(u) for u in data.get("results", [])]

    async def create_issue(self, media_id: int, issue_type: int, message: str, user_id: int) -> int:
        body = {"issueType": issue_type, "message": message, "mediaId": media_id, "userId": user_id}
        return int((await self.post_json("/api/v1/issue", body))["id"])


@dataclass
class FakeSeerrClient:
    results: list[SearchResult] = field(default_factory=list)
    user_list: list[SeerrUser] = field(default_factory=list)
    requests: list[MediaRequest] = field(default_factory=list)
    issues: list[dict[str, Any]] = field(default_factory=list)
    auto_approve: bool = False

    async def search(self, query: str) -> list[SearchResult]:
        q = query.lower()
        return [r for r in self.results if q in r.title.lower()]

    async def create_request(
        self,
        media_type: str,
        tmdb_id: int,
        *,
        is_4k: bool = False,
        seasons: list[int] | None = None,
        as_user: int | None = None,
    ) -> MediaRequest:
        req = MediaRequest(
            id=len(self.requests) + 1,
            status=REQUEST_APPROVED if self.auto_approve else REQUEST_PENDING,
            media_type=media_type,
            tmdb_id=tmdb_id,
            is_4k=is_4k,
            requested_by_id=as_user or 0,
            seasons=tuple(seasons or ()),
        )
        self.requests.append(req)
        return req

    async def list_requests(
        self, *, user_id: int | None = None, take: int = 20
    ) -> list[MediaRequest]:
        rows = [r for r in self.requests if user_id is None or r.requested_by_id == user_id]
        return rows[-take:]

    async def approve_request(self, request_id: int) -> MediaRequest:
        for i, r in enumerate(self.requests):
            if r.id == request_id:
                self.requests[i] = MediaRequest(**{**r.__dict__, "status": REQUEST_APPROVED})
                return self.requests[i]
        raise KeyError(request_id)

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
