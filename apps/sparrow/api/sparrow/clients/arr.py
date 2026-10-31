"""What Sonarr and Radarr share: the v3 API shape, queue, history, files and searches.

Every instance is constructed with its host name so errors and audit rows can
say which stack was touched. The two speak the same verbs (`files`,
`delete_file`, `search`, `find_id`) over their own routes, so code that works
on a title's copy needn't know which arr holds it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, ClassVar, Protocol

from sparrow.clients.base import Downable, HttpClient

if TYPE_CHECKING:
    from sparrow.clients.seerr import MediaDetails


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
    episode_id: int | None = None  # Sonarr: the episode this record is for
    # What it's a download of, as people name it: "Dune (2021)", "The Bear S02E07".
    media_title: str = ""

    @property
    def label(self) -> str:
        return self.media_title or self.title

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
            episode_id=raw.get("episodeId"),
            media_title=_queued_title(raw),
        )


def _queued_title(raw: dict[str, Any]) -> str:
    """The movie or episode a queue record is for, when the arr included it."""
    media = raw.get("movie") or raw.get("series") or {}
    if not media.get("title"):
        return ""
    title = f"{media['title']} ({media['year']})" if media.get("year") else media["title"]
    episode = raw.get("episode") or {}
    if episode.get("seasonNumber") is not None and episode.get("episodeNumber") is not None:
        return f"{title} S{int(episode['seasonNumber']):02d}E{int(episode['episodeNumber']):02d}"
    return title


@dataclass(frozen=True)
class RootFolder:
    """Where an arr puts media; free and total space as it read them, when it did."""

    path: str
    free_bytes: int | None = None
    total_bytes: int | None = None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> RootFolder:
        free, total = raw.get("freeSpace"), raw.get("totalSpace")
        return cls(
            raw.get("path") or "",
            int(free) if free is not None else None,
            int(total) if total else None,
        )


@dataclass(frozen=True)
class DiskSpace:
    """A disk mounted in the arr's container."""

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
    indexer: str = ""  # for a grab: where it came from
    reason: str = ""  # for a deleted file: why ("Upgrade", "Manual", "MissingFromDisk")
    quality: str = ""
    release_group: str = ""

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
            indexer=data.get("indexer") or "",
            reason=data.get("reason") or "",
            quality=((raw.get("quality") or {}).get("quality") or {}).get("name") or "",
            release_group=data.get("releaseGroup") or "",
        )


# One read holds the whole queue: a download left off a page would look gone.
QUEUE_PAGE = 1000


class Arr(Protocol):
    """What every Sonarr and Radarr answers, by the title's id in it."""

    host: str
    base_url: str

    async def ping(self) -> None: ...
    async def root_folders(self) -> list[RootFolder]: ...
    async def disk_space(self) -> list[DiskSpace]: ...
    async def queue(self) -> list[QueueItem]: ...
    async def history(self, media_id: int) -> list[HistoryEvent]: ...
    async def find_id(self, details: MediaDetails) -> int | None: ...
    async def files(self, media_id: int) -> list[MediaFile]: ...
    async def delete_file(self, file_id: int) -> None: ...
    async def search(self, ids: list[int]) -> int: ...
    async def mark_failed(self, history_id: int) -> None: ...
    async def remove_from_queue(self, queue_id: int, *, blocklist: bool = True) -> None: ...


class ArrClient(HttpClient):
    api = "/api/v3"
    health_path = "/api/v3/system/status"  # checks the API key too
    # Per-title history lives at /history/movie?movieId= or /history/series?seriesId=.
    history_scope: tuple[str, str]
    # What a queue read includes besides the downloads: the titles they're for.
    queue_includes: tuple[str, ...]
    # A title's files live at /moviefile?movieId= or /episodefile?seriesId=.
    file_scope: tuple[str, str]
    # The command that searches for a movie (by its id) or for episodes (by theirs).
    search_command: tuple[str, str]

    def __init__(self, host: str, base_url: str, api_key: str, **kwargs: Any):
        super().__init__(base_url, headers={"X-Api-Key": api_key}, **kwargs)
        self.host = host

    async def root_folders(self) -> list[RootFolder]:
        return [RootFolder.from_api(r) for r in await self.get_json(f"{self.api}/rootfolder")]

    async def disk_space(self) -> list[DiskSpace]:
        return [
            DiskSpace(d["path"], int(d.get("freeSpace") or 0), int(d.get("totalSpace") or 0))
            for d in await self.get_json(f"{self.api}/diskspace")
        ]

    async def queue(self) -> list[QueueItem]:
        data = await self.get_json(
            f"{self.api}/queue",
            params={"pageSize": QUEUE_PAGE, **dict.fromkeys(self.queue_includes, "true")},
        )
        return [QueueItem.from_api(r) for r in data.get("records", [])]

    async def mark_failed(self, history_id: int) -> None:
        """Mark a grab failed, which blocklists the release so it is not re-grabbed."""
        await self.post_json(f"{self.api}/history/failed/{history_id}")

    async def remove_from_queue(self, queue_id: int, *, blocklist: bool = True) -> None:
        """Remove a download from the client, blocklisting its release. The arr's own
        search for a replacement is skipped: the caller searches, so it happens once."""
        params = {
            "removeFromClient": "true",
            "blocklist": "true" if blocklist else "false",
            "skipRedownload": "true",
        }
        await self.delete(f"{self.api}/queue/{queue_id}", params=params)

    async def command(self, name: str, **params: Any) -> int:
        result = await self.post_json(f"{self.api}/command", {"name": name, **params})
        return int(result["id"])

    async def files(self, media_id: int) -> list[MediaFile]:
        """A title's files: a movie's one, or every episode file of a series."""
        route, key = self.file_scope
        rows = await self.get_json(f"{self.api}/{route}", params={key: media_id})
        return [MediaFile.from_api(r) for r in rows]

    async def delete_file(self, file_id: int) -> None:
        await self.delete(f"{self.api}/{self.file_scope[0]}/{file_id}")

    async def search(self, ids: list[int]) -> int:
        """Search for these movies, or these episodes; the command's id."""
        name, key = self.search_command
        return await self.command(name, **{key: ids})

    async def history(self, media_id: int) -> list[HistoryEvent]:
        """One title's download history, newest first."""
        scope, key = self.history_scope
        rows = await self.get_json(f"{self.api}/history/{scope}", params={key: media_id})
        return sorted((HistoryEvent.from_api(r) for r in rows), key=lambda e: e.date, reverse=True)


def roomy(path: str) -> list[RootFolder]:
    """A fake arr's root folder has room unless a test says otherwise: 8 of 16 TB free."""
    return [RootFolder(path, 8_000_000_000_000, 16_000_000_000_000)]


@dataclass
class FakeArr(Downable):
    """What the fake Radarr and Sonarr share: the shared verbs over in-memory records, each
    write remembered so a test can see what was done. A fake adds its kind's lookups."""

    service: ClassVar[str]

    host: str = "fake"
    base_url: str = ""
    roots: list[RootFolder] = field(default_factory=list)
    disks: list[DiskSpace] = field(default_factory=list)
    queue_items: list[QueueItem] = field(default_factory=list)
    # Download history per movie or series id, newest first.
    events: dict[int, list[HistoryEvent]] = field(default_factory=dict)
    file_list: list[MediaFile] = field(default_factory=list)
    failed: list[int] = field(default_factory=list)
    removed: list[int] = field(default_factory=list)  # queue ids, blocklisted
    searched: list[list[int]] = field(default_factory=list)
    deleted: list[int] = field(default_factory=list)

    async def root_folders(self) -> list[RootFolder]:
        self.refuse_if_down("/api/v3/rootfolder")
        return list(self.roots)

    async def disk_space(self) -> list[DiskSpace]:
        self.refuse_if_down("/api/v3/diskspace")
        return list(self.disks)

    async def queue(self) -> list[QueueItem]:
        self.refuse_if_down("/api/v3/queue")
        return list(self.queue_items)

    async def remove_from_queue(self, queue_id: int, *, blocklist: bool = True) -> None:
        self.refuse_if_down(f"/api/v3/queue/{queue_id}")
        gone = next(q for q in self.queue_items if q.id == queue_id)
        self.removed.append(queue_id)
        # A download goes with every record of it (a season pack is one per episode).
        self.queue_items = [q for q in self.queue_items if q.download_id != gone.download_id]

    async def history(self, media_id: int) -> list[HistoryEvent]:
        return list(self.events.get(media_id, []))

    async def files(self, media_id: int) -> list[MediaFile]:
        return [f for f in self.file_list if f.media_id == media_id]

    async def delete_file(self, file_id: int) -> None:
        self.deleted.append(file_id)
        self.file_list = [f for f in self.file_list if f.id != file_id]

    async def search(self, ids: list[int]) -> int:
        self.searched.append(list(ids))
        return len(self.searched)

    async def mark_failed(self, history_id: int) -> None:
        self.failed.append(history_id)
