"""The Seerr HTTP client and the protocol tools depend on."""

from __future__ import annotations

import json
from typing import Any, Protocol

from maester.clients.base import ClientError, HttpClient
from maester.clients.seerr.models import (
    ArrServer,
    Collection,
    MediaDetails,
    MediaRequest,
    Quota,
    Quotas,
    RequestRefused,
    Routing,
    SearchResult,
    SeerrUser,
    ServerOptions,
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
        self,
        media_id: int,
        issue_type: int,
        message: str,
        *,
        as_user: int,
        season: int | None = None,
        episode: int | None = None,
    ) -> int: ...
    async def comment_issue(self, issue_id: int, message: str) -> None: ...


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
        """Seerr's Radarr or Sonarr servers, from its settings (the API key is an admin's)."""
        return [ArrServer.from_api(s) for s in await self.get_json(f"/api/v1/settings/{kind}")]

    async def server_options(self, kind: str, server_id: int) -> ServerOptions:
        return ServerOptions.from_api(await self.get_json(f"/api/v1/service/{kind}/{server_id}"))

    async def users(self) -> list[SeerrUser]:
        data = await self.get_json("/api/v1/user", params={"take": 500})
        return [SeerrUser.from_api(u) for u in data.get("results", [])]

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
        """File an issue against Seerr's media id, created by `as_user`. A show's issue can
        name the season and episode."""
        body: dict[str, Any] = {
            "issueType": issue_type,
            "message": message,
            "mediaId": media_id,
            # Not `X-API-User`, as requests use: Seerr's issue route files as `userId` for a
            # caller with MANAGE_ISSUES (maester's key), whatever the user's own permissions.
            "userId": as_user,
        }
        if season is not None:
            body["problemSeason"] = season
        if episode is not None:
            body["problemEpisode"] = episode
        return int((await self.post_json("/api/v1/issue", body))["id"])

    async def comment_issue(self, issue_id: int, message: str) -> None:
        await self.post_json(f"/api/v1/issue/{issue_id}/comment", {"message": message})


def _message(detail: str) -> str:
    """The sentence in a Seerr error body (`{"message": "..."}`), or the body itself."""
    try:
        return str(json.loads(detail).get("message") or detail)
    except (ValueError, AttributeError):
        return detail
