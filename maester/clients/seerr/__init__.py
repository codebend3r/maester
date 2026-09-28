"""Seerr (Overseerr fork): search, details, collections, requests, quotas, users, issues.

Requests are made on a friend's behalf with the `X-API-User` header so Seerr
applies that user's quotas and permissions, and the request shows under their
name rather than the bot's. When Seerr refuses a request it answers with a
status and one sentence (quota, permission, duplicate, nothing left to
request); `create_request` turns those into a typed `RequestRefused` so tools
can explain them in plain words.
"""

from maester.clients.seerr.client import Seerr, SeerrClient
from maester.clients.seerr.fake import FakeSeerrClient
from maester.clients.seerr.models import (
    ANIMATION_GENRE,
    ANIME_KEYWORD,
    ISSUE_AUDIO,
    ISSUE_OTHER,
    ISSUE_SUBTITLE,
    ISSUE_VIDEO,
    TMDB_POSTER,
    UNLIMITED,
    ArrRef,
    ArrServer,
    Collection,
    MediaDetails,
    MediaRequest,
    MediaStatus,
    Named,
    Quota,
    Quotas,
    Refusal,
    RequestRefused,
    RequestStatus,
    Routing,
    SearchResult,
    Season,
    SeerrUser,
    ServerOptions,
)

__all__ = [
    "ANIMATION_GENRE",
    "ANIME_KEYWORD",
    "ISSUE_AUDIO",
    "ISSUE_OTHER",
    "ISSUE_SUBTITLE",
    "ISSUE_VIDEO",
    "TMDB_POSTER",
    "UNLIMITED",
    "ArrRef",
    "ArrServer",
    "Collection",
    "FakeSeerrClient",
    "MediaDetails",
    "MediaRequest",
    "MediaStatus",
    "Named",
    "Quota",
    "Quotas",
    "Refusal",
    "RequestRefused",
    "RequestStatus",
    "Routing",
    "SearchResult",
    "Season",
    "Seerr",
    "SeerrClient",
    "SeerrUser",
    "ServerOptions",
]
