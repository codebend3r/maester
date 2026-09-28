"""An in-memory Seerr with the client's methods, for tools, tests and evals."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from maester.clients.base import ClientError
from maester.clients.seerr.models import (
    UNLIMITED,
    ArrServer,
    Collection,
    MediaDetails,
    MediaRequest,
    MediaStatus,
    Quotas,
    RequestRefused,
    RequestStatus,
    Routing,
    SearchResult,
    SeerrUser,
    ServerOptions,
)


@dataclass
class FakeSeerrClient:
    results: list[SearchResult] = field(default_factory=list)
    details: dict[tuple[str, int], MediaDetails] = field(default_factory=dict)
    collections: dict[int, Collection] = field(default_factory=dict)
    user_list: list[SeerrUser] = field(default_factory=list)
    requests: list[MediaRequest] = field(default_factory=list)
    quotas: dict[int, Quotas] = field(default_factory=dict)
    # Seerr's Radarr/Sonarr servers by kind, and each one's profiles and tags.
    arr_servers: dict[str, list[ArrServer]] = field(default_factory=dict)
    options: dict[tuple[str, int], ServerOptions] = field(default_factory=dict)
    # A refusal to raise for a TMDB id, the way Seerr would answer.
    refusals: dict[int, RequestRefused] = field(default_factory=dict)
    routed: dict[int, Routing] = field(default_factory=dict)
    issues: list[dict[str, Any]] = field(default_factory=list)
    auto_approve: bool = False
    # While set, approving, declining and filing issues answer the way an
    # unreachable Seerr would.
    down: bool = False

    async def search(self, query: str) -> list[SearchResult]:
        q = query.lower()
        return [r for r in self.results if q in r.title.lower()]

    async def media_details(self, media_type: str, tmdb_id: int) -> MediaDetails:
        try:
            return self.details[(media_type, tmdb_id)]
        except KeyError:
            raise ClientError("seerr", "GET", f"/api/v1/{media_type}/{tmdb_id}", 404, "") from None

    async def collection(self, collection_id: int) -> Collection:
        try:
            return self.collections[collection_id]
        except KeyError:
            path = f"/api/v1/collection/{collection_id}"
            raise ClientError("seerr", "GET", path, 404, "") from None

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
        elif filter == "failed":
            rows = [r for r in rows if r.status == RequestStatus.FAILED]
        return rows[-take:]

    async def approve_request(self, request_id: int) -> MediaRequest:
        return self._set_status(request_id, RequestStatus.APPROVED)

    async def decline_request(self, request_id: int) -> MediaRequest:
        return self._set_status(request_id, RequestStatus.DECLINED)

    def _set_status(self, request_id: int, status: RequestStatus) -> MediaRequest:
        if self.down:
            path = f"/api/v1/request/{request_id}"
            raise ClientError("seerr", "POST", path, None, "connection refused")
        for i, r in enumerate(self.requests):
            if r.id == request_id:
                self.requests[i] = replace(r, status=status)
                return self.requests[i]
        raise KeyError(request_id)

    async def quota(self, user_id: int) -> Quotas:
        return self.quotas.get(user_id, Quotas(UNLIMITED, UNLIMITED))

    async def servers(self, kind: str) -> list[ArrServer]:
        return list(self.arr_servers.get(kind, []))

    async def server_options(self, kind: str, server_id: int) -> ServerOptions:
        return self.options[(kind, server_id)]

    async def users(self) -> list[SeerrUser]:
        return list(self.user_list)

    async def create_issue(
        self,
        media_id: int,
        issue_type: int,
        message: str,
        *,
        as_user: int,
        season: int | None = None,
        episode: int | None = None,
    ) -> int:
        if self.down:
            raise ClientError("seerr", "POST", "/api/v1/issue", None, "connection refused")
        self.issues.append(
            {
                "id": len(self.issues) + 1,
                "mediaId": media_id,
                "issueType": issue_type,
                "message": message,
                "as_user": as_user,
                "problemSeason": season,
                "problemEpisode": episode,
                "comments": [],
            }
        )
        return self.issues[-1]["id"]

    async def comment_issue(self, issue_id: int, message: str) -> None:
        self.issues[issue_id - 1]["comments"].append(message)
