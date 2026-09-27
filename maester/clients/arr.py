"""What Sonarr and Radarr share: the v3 API shape, queue, history and commands.

Every instance is constructed with its host name so errors and audit rows can
say which stack was touched.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from maester.clients.base import HttpClient


@dataclass(frozen=True)
class QueueItem:
    id: int
    title: str
    status: str
    size_bytes: int
    size_left_bytes: int
    time_left: str | None
    error_messages: tuple[str, ...]
    download_id: str | None
    media_id: int  # movieId or seriesId
    # The arr's verdict on the download: "ok", "warning" (stalled, blocked) or "error".
    tracked_status: str = "ok"

    @property
    def percent(self) -> float:
        if not self.size_bytes:
            return 0.0
        return round(100 * (1 - self.size_left_bytes / self.size_bytes), 1)

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> QueueItem:
        return cls(
            id=int(raw["id"]),
            title=raw.get("title") or "",
            status=raw.get("status") or "",
            size_bytes=int(raw.get("size") or 0),
            size_left_bytes=int(raw.get("sizeleft") or 0),
            time_left=raw.get("timeleft"),
            error_messages=tuple(
                text
                for text in (
                    raw.get("errorMessage"),
                    *(
                        m
                        for sm in raw.get("statusMessages") or []
                        for m in sm.get("messages") or []
                    ),
                )
                if text
            ),
            download_id=raw.get("downloadId"),
            media_id=int(raw.get("movieId") or raw.get("seriesId") or 0),
            tracked_status=raw.get("trackedDownloadStatus") or "ok",
        )


@dataclass(frozen=True)
class DiskSpace:
    path: str
    free_bytes: int
    total_bytes: int

    @property
    def used_percent(self) -> float:
        return round(100 * (1 - self.free_bytes / self.total_bytes), 1) if self.total_bytes else 0.0


@dataclass(frozen=True)
class MediaFile:
    id: int
    path: str
    size_bytes: int
    quality: str
    release_group: str | None
    media_id: int
    season: int | None = None  # episode files only
    # Audio track languages as the arr read them ("eng", "jpn"; older Sonarr
    # writes "English"); None until the arr has analyzed the file.
    audio_languages: tuple[str, ...] | None = None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> MediaFile:
        info = raw.get("mediaInfo")
        return cls(
            id=int(raw["id"]),
            path=raw.get("path") or "",
            size_bytes=int(raw.get("size") or 0),
            quality=((raw.get("quality") or {}).get("quality") or {}).get("name") or "",
            release_group=raw.get("releaseGroup"),
            media_id=int(raw.get("movieId") or raw.get("seriesId") or 0),
            season=raw.get("seasonNumber"),
            audio_languages=(
                tuple(t.strip() for t in (info.get("audioLanguages") or "").split("/") if t.strip())
                if info
                else None
            ),
        )


@dataclass(frozen=True)
class HistoryEvent:
    id: int  # what `mark_failed` takes to blocklist the grabbed release
    event_type: str  # "grabbed", "downloadFailed", "downloadFolderImported", ...
    source_title: str
    date: str
    download_id: str | None
    message: str  # why, for failures; empty otherwise
    file_id: int | None = None  # for an import: the movie or episode file it made
    episode_id: int | None = None  # Sonarr: which episode the event is about

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> HistoryEvent:
        data = raw.get("data") or {}
        return cls(
            id=int(raw["id"]),
            event_type=raw.get("eventType") or "",
            source_title=raw.get("sourceTitle") or "",
            date=raw.get("date") or "",
            download_id=raw.get("downloadId"),
            message=data.get("message") or "",
            file_id=int(data["fileId"]) if data.get("fileId") else None,
            episode_id=raw.get("episodeId"),
        )


class ArrClient(HttpClient):
    api = "/api/v3"
    # Per-title history lives at /history/movie?movieId= or /history/series?seriesId=.
    history_scope: tuple[str, str]

    def __init__(self, host: str, base_url: str, api_key: str, **kwargs: Any):
        super().__init__(base_url, headers={"X-Api-Key": api_key}, **kwargs)
        self.host = host

    async def ping(self) -> None:
        """The arr's system status, which also checks the API key."""
        await self.get_json(f"{self.api}/system/status")

    async def root_folders(self) -> list[str]:
        return [r["path"] for r in await self.get_json(f"{self.api}/rootfolder")]

    async def disk_space(self) -> list[DiskSpace]:
        return [
            DiskSpace(d["path"], int(d.get("freeSpace") or 0), int(d.get("totalSpace") or 0))
            for d in await self.get_json(f"{self.api}/diskspace")
        ]

    async def queue(self) -> list[QueueItem]:
        data = await self.get_json(
            f"{self.api}/queue", params={"pageSize": 200, "includeUnknownMovieItems": "true"}
        )
        return [QueueItem.from_api(r) for r in data.get("records", [])]

    async def mark_failed(self, history_id: int) -> None:
        """Mark a grab failed, which blocklists the release so it is not re-grabbed."""
        await self.post_json(f"{self.api}/history/failed/{history_id}")

    async def remove_from_queue(self, queue_id: int, *, blocklist: bool = True) -> None:
        params = {"removeFromClient": "true", "blocklist": "true" if blocklist else "false"}
        await self.delete(f"{self.api}/queue/{queue_id}", params=params)

    async def command(self, name: str, **params: Any) -> int:
        result = await self.post_json(f"{self.api}/command", {"name": name, **params})
        return int(result["id"])

    async def history(self, media_id: int) -> list[HistoryEvent]:
        """One title's download history, newest first."""
        scope, key = self.history_scope
        rows = await self.get_json(f"{self.api}/history/{scope}", params={key: media_id})
        return sorted((HistoryEvent.from_api(r) for r in rows), key=lambda e: e.date, reverse=True)
