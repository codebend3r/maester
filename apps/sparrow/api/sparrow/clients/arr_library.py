"""Each Radarr, Sonarr and Lidarr's own library and setup, as the admin sees them in its UI.

The request and repair tools reach Radarr and Sonarr through `arr.py`, by a
title's id there. The admin's questions need the arr as a whole instead: every
title with its path, size and state, the custom filters saved in its list,
root folders, tags, quality profiles, disks, health, the queue and recent
history. A move changes a title's path and lets the arr move its files, the
way the UI's editor does. Lidarr speaks v1 and lists artists; Radarr lists
movies and Sonarr series, both on v3.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from sparrow.clients.arr import DiskSpace, RootFolder
from sparrow.clients.base import Downable, HttpClient
from sparrow.registry import Instance

ArrService = Literal["radarr", "sonarr", "lidarr"]
ARR_SERVICES: tuple[ArrService, ...] = ("radarr", "sonarr", "lidarr")


@dataclass(frozen=True)
class Shape:
    """Where a kind of arr keeps its titles and how its history names them."""

    api: str
    route: str  # movie, series or artist
    history_includes: tuple[str, ...]


SHAPES: dict[ArrService, Shape] = {
    "radarr": Shape("/api/v3", "movie", ("includeMovie",)),
    "sonarr": Shape("/api/v3", "series", ("includeSeries", "includeEpisode")),
    "lidarr": Shape("/api/v1", "artist", ("includeArtist", "includeAlbum")),
}


@dataclass(frozen=True)
class ArrTitle:
    """A movie, series or artist, with what is on disk of it: a movie's one file, a
    series' episodes or an artist's tracks (`have` of `want`)."""

    id: int
    title: str
    year: int | None
    path: str
    monitored: bool
    status: str
    added: str | None
    size_bytes: int
    have: int
    want: int
    profile: str | None
    tags: tuple[str, ...]
    quality: str | None  # a movie file's
    release: str | None  # a movie's release date, a series' first airing (YYYY-MM-DD)
    # The arr's own record, which the admin's saved custom filters are read against.
    raw: dict[str, Any] = field(default_factory=dict, compare=False, repr=False)

    @property
    def folder(self) -> str:
        return self.path.rstrip("/").rsplit("/", 1)[-1]

    @classmethod
    def from_api(
        cls,
        service: ArrService,
        raw: dict[str, Any],
        profiles: dict[int, str],
        tags: dict[int, str],
    ) -> ArrTitle:
        stats = raw.get("statistics") or {}
        have, want = _counts(service, raw, stats)
        movie_file = raw.get("movieFile") or {}
        release = (
            raw.get("digitalRelease") or raw.get("physicalRelease") or raw.get("inCinemas")
            if service == "radarr"
            else raw.get("firstAired")
        )
        return cls(
            id=int(raw["id"]),
            title=raw.get("title") or raw.get("artistName") or "",
            year=raw.get("year") or None,
            path=raw.get("path") or "",
            monitored=bool(raw.get("monitored")),
            status=raw.get("status") or "",
            added=(raw.get("added") or "")[:10] or None,
            size_bytes=int(raw.get("sizeOnDisk") or stats.get("sizeOnDisk") or 0),
            have=have,
            want=want,
            profile=profiles.get(raw.get("qualityProfileId") or 0),
            tags=tuple(tags[t] for t in raw.get("tags") or [] if t in tags),
            quality=((movie_file.get("quality") or {}).get("quality") or {}).get("name"),
            release=release[:10] if release else None,
            raw=raw,
        )


def _counts(service: ArrService, raw: dict[str, Any], stats: dict[str, Any]) -> tuple[int, int]:
    if service == "radarr":
        return (1 if raw.get("hasFile") else 0), 1
    if service == "sonarr":
        return int(stats.get("episodeFileCount") or 0), int(stats.get("episodeCount") or 0)
    return int(stats.get("trackFileCount") or 0), int(stats.get("trackCount") or 0)


@dataclass(frozen=True)
class CustomFilter:
    """A filter the admin saved in the arr's UI: every rule must hold for a title to show.
    Each rule is the UI's own `{key, value, type}`, read against the title's record."""

    label: str
    kind: str  # the list it was saved on: movieIndex, series, artistIndex...
    rules: tuple[dict[str, Any], ...]

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> CustomFilter:
        return cls(raw.get("label") or "", raw.get("type") or "", tuple(raw.get("filters") or []))


@dataclass(frozen=True)
class Setup:
    """How an arr is set up and how it is doing."""

    version: str
    root_folders: tuple[RootFolder, ...]
    filters: tuple[CustomFilter, ...]
    tags: tuple[str, ...]
    profiles: tuple[str, ...]
    disks: tuple[DiskSpace, ...]
    health: tuple[str, ...]  # "error: Multiple root folders are missing: ..."
    queued: int


@dataclass(frozen=True)
class HistoryRow:
    when: str
    event: str  # the arr's own event type: grabbed, downloadFolderImported...
    title: str  # what it is about: "Dune (2021)", "The Bear S02E07", "Adele: 30"
    release: str
    quality: str | None
    why: str | None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> HistoryRow:
        data = raw.get("data") or {}
        return cls(
            when=raw.get("date") or "",
            event=raw.get("eventType") or "",
            title=_history_title(raw),
            release=raw.get("sourceTitle") or "",
            quality=((raw.get("quality") or {}).get("quality") or {}).get("name"),
            why=data.get("message") or data.get("reason") or data.get("statusMessages") or None,
        )


def _history_title(raw: dict[str, Any]) -> str:
    if movie := raw.get("movie"):
        return f"{movie['title']} ({movie['year']})" if movie.get("year") else movie["title"]
    if series := raw.get("series"):
        episode = raw.get("episode") or {}
        if episode.get("seasonNumber") is None or episode.get("episodeNumber") is None:
            return series["title"]
        return f"{series['title']} S{episode['seasonNumber']:02d}E{episode['episodeNumber']:02d}"
    if artist := raw.get("artist"):
        album = (raw.get("album") or {}).get("title")
        return f"{artist['artistName']}: {album}" if album else artist["artistName"]
    return raw.get("sourceTitle") or ""


class ArrLibrary(Protocol):
    service: ArrService
    host: str
    base_url: str

    async def titles(self) -> list[ArrTitle]: ...
    async def setup(self) -> Setup: ...
    async def history(self, count: int) -> list[HistoryRow]: ...
    async def move(self, title_id: int, path: str) -> None: ...


# A library of thousands of titles is one large answer (Sonarr's series run to megabytes).
LIBRARY_TIMEOUT = 120.0


class ArrLibraryClient(HttpClient):
    def __init__(self, service: ArrService, host: str, base_url: str, api_key: str, **kwargs: Any):
        kwargs.setdefault("timeout", LIBRARY_TIMEOUT)
        super().__init__(base_url, headers={"X-Api-Key": api_key}, **kwargs)
        self.service: ArrService = service
        self.host = host
        self.shape = SHAPES[service]
        self.health_path = f"{self.shape.api}/system/status"

    def _path(self, route: str) -> str:
        return f"{self.shape.api}/{route}"

    async def titles(self) -> list[ArrTitle]:
        rows, profiles, tags = await asyncio.gather(
            self.get_json(self._path(self.shape.route)), self._profiles(), self._tags()
        )
        return [ArrTitle.from_api(self.service, r, profiles, tags) for r in rows]

    async def _profiles(self) -> dict[int, str]:
        return {int(p["id"]): p["name"] for p in await self.get_json(self._path("qualityprofile"))}

    async def _tags(self) -> dict[int, str]:
        return {int(t["id"]): t["label"] for t in await self.get_json(self._path("tag"))}

    async def setup(self) -> Setup:
        status, roots, filters, tags, profiles, disks, health, queue = await asyncio.gather(
            self.get_json(self._path("system/status")),
            self.get_json(self._path("rootfolder")),
            self.get_json(self._path("customfilter")),
            self._tags(),
            self._profiles(),
            self.get_json(self._path("diskspace")),
            self.get_json(self._path("health")),
            self.get_json(self._path("queue"), params={"pageSize": 1}),
        )
        return Setup(
            version=status.get("version") or "",
            root_folders=tuple(RootFolder.from_api(r) for r in roots),
            filters=tuple(CustomFilter.from_api(f) for f in filters),
            tags=tuple(tags.values()),
            profiles=tuple(profiles.values()),
            disks=tuple(
                DiskSpace(d["path"], int(d.get("freeSpace") or 0), int(d.get("totalSpace") or 0))
                for d in disks
            ),
            health=tuple(f"{h.get('type')}: {h.get('message')}" for h in health),
            queued=int(queue.get("totalRecords") or 0),
        )

    async def history(self, count: int) -> list[HistoryRow]:
        """The newest `count` events, newest first."""
        params = {
            "page": 1,
            "pageSize": count,
            "sortKey": "date",
            "sortDirection": "descending",
            **dict.fromkeys(self.shape.history_includes, "true"),
        }
        data = await self.get_json(self._path("history"), params=params)
        return [HistoryRow.from_api(r) for r in data.get("records", [])]

    async def move(self, title_id: int, path: str) -> None:
        """Give a title a new path; the arr moves its files there in the background."""
        route = self._path(f"{self.shape.route}/{title_id}")
        record = await self.get_json(route)
        record |= {"path": path, "rootFolderPath": path.rstrip("/").rsplit("/", 1)[0]}
        await self.put_json(route, record, params={"moveFiles": "true"})


def arr_libraries(
    instances: list[Instance], **kwargs: Any
) -> dict[ArrService, dict[str, ArrLibrary]]:
    """An `ArrLibraryClient` for every Radarr, Sonarr and Lidarr configured, by service and host."""
    return {
        service: {
            i.host: ArrLibraryClient(service, i.host, i.url, i.api_key, **kwargs)
            for i in instances
            if i.service == service
        }
        for service in ARR_SERVICES
    }


@dataclass
class FakeArrLibrary(Downable):
    """An arr over in-memory records shaped like its API's, so filters read them as for real."""

    service: ArrService = "radarr"
    host: str = "fake"
    base_url: str = "http://arr.test"
    records: list[dict[str, Any]] = field(default_factory=list)
    filters: list[CustomFilter] = field(default_factory=list)
    roots: list[RootFolder] = field(default_factory=list)
    events: list[HistoryRow] = field(default_factory=list)
    health: list[str] = field(default_factory=list)
    queued: int = 0
    moved: list[tuple[int, str]] = field(default_factory=list)  # (title id, new path)

    async def titles(self) -> list[ArrTitle]:
        self.refuse_if_down(SHAPES[self.service].route)
        return [ArrTitle.from_api(self.service, r, {}, {}) for r in self.records]

    async def setup(self) -> Setup:
        self.refuse_if_down("system/status")
        return Setup(
            "fake",
            tuple(self.roots),
            tuple(self.filters),
            (),
            (),
            (),
            tuple(self.health),
            self.queued,
        )

    async def history(self, count: int) -> list[HistoryRow]:
        self.refuse_if_down("history")
        return self.events[:count]

    async def move(self, title_id: int, path: str) -> None:
        self.refuse_if_down(f"{SHAPES[self.service].route}/{title_id}")
        self.moved.append((title_id, path))
        record = next(r for r in self.records if r["id"] == title_id)
        record |= {"path": path, "rootFolderPath": path.rstrip("/").rsplit("/", 1)[0]}
