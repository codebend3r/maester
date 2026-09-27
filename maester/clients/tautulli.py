"""Tautulli: live sessions, watch history, stream details, users and recent additions.

This is where playback diagnosis gets its facts: the server's decision on
each stream (Tautulli gives no reasons for a transcode), LAN vs WAN, relay,
bandwidth, and how fast a transcode runs against real time. A finished play
keeps only a summary in the history; `stream_data` fetches what it was sent
(codecs, decisions, bitrates) by its history row. Every bitrate and
bandwidth is Plex's own figure, in kbps. Everything is one `/api/v2?cmd=`
call.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, ClassVar, Protocol

from maester.clients.base import ClientError, Downable, HttpClient


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _title_tmdb_id(raw: dict[str, Any]) -> int | None:
    """The title's TMDB id among Plex's guids ("tmdb://438631"): an episode's show's, from
    `grandparent_guids`; None when the server has no TMDB match for it."""
    key = "grandparent_guids" if raw.get("media_type") == "episode" else "guids"
    for guid in raw.get(key) or []:
        if isinstance(guid, str) and guid.startswith("tmdb://"):
            return _int(guid.removeprefix("tmdb://"), 0) or None
    return None


def _index(raw: dict[str, Any], key: str) -> int | None:
    """A season or episode number; Tautulli leaves it empty for movies."""
    value = raw.get(key)
    return None if raw.get("media_type") != "episode" or value in (None, "") else int(value)


@dataclass(frozen=True)
class Session:
    session_key: str
    user_id: int
    user: str
    rating_key: str
    full_title: str
    media_type: str
    state: str
    progress_percent: int
    platform: str
    player: str
    product: str
    location: str  # "lan" | "wan" | "cellular"
    relayed: bool  # sent through Plex's relay rather than straight from the server
    secure: bool
    bandwidth_kbps: int  # what Plex reserves for the stream
    stream_bitrate_kbps: int  # what the stream is sent at
    transcode_decision: str  # "direct play" | "copy" | "transcode"
    video_decision: str
    audio_decision: str
    subtitle_decision: str
    container: str
    video_codec: str
    video_resolution: str
    video_dynamic_range: str
    audio_codec: str
    audio_channels: int
    subtitle_codec: str
    file: str
    # For episodes: the show's Plex key, and which episode it is.
    show_key: str = ""
    season: int | None = None
    episode: int | None = None
    device: str = ""  # the hardware, e.g. "SHIELD Android TV"
    dovi_profile: int = 0  # the file's Dolby Vision profile; 0 when it has none
    source_bitrate_kbps: int = 0  # the file's own bitrate
    # A transcode's speed against real time (1.0 keeps pace); 0 when nothing is
    # transcoded. A throttled transcoder is ahead and resting, so its speed reads low.
    transcode_speed: float = 0.0
    transcode_throttled: bool = False
    # The title's TMDB id (a show's, for an episode) as the Plex server playing it knows it;
    # None when it has no TMDB match.
    tmdb_id: int | None = None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Session:
        return cls(
            session_key=str(raw.get("session_key") or ""),
            user_id=_int(raw.get("user_id")),
            user=raw.get("friendly_name") or raw.get("user") or "",
            rating_key=str(raw.get("rating_key") or ""),
            full_title=raw.get("full_title") or raw.get("title") or "",
            media_type=raw.get("media_type") or "",
            state=raw.get("state") or "",
            progress_percent=_int(raw.get("progress_percent")),
            platform=raw.get("platform") or "",
            player=raw.get("player") or "",
            product=raw.get("product") or "",
            location=raw.get("location") or "",
            relayed=_int(raw.get("relayed")) == 1,
            secure=_int(raw.get("secure")) == 1,
            bandwidth_kbps=_int(raw.get("bandwidth")),
            stream_bitrate_kbps=_int(raw.get("stream_bitrate")),
            transcode_decision=raw.get("transcode_decision") or "",
            video_decision=raw.get("stream_video_decision") or "",
            audio_decision=raw.get("stream_audio_decision") or "",
            subtitle_decision=raw.get("stream_subtitle_decision") or "",
            container=raw.get("container") or "",
            video_codec=raw.get("video_codec") or "",
            video_resolution=raw.get("video_full_resolution") or raw.get("video_resolution") or "",
            video_dynamic_range=raw.get("video_dynamic_range") or "",
            audio_codec=raw.get("audio_codec") or "",
            audio_channels=_int(raw.get("audio_channels")),
            subtitle_codec=raw.get("subtitle_codec") or "",
            file=raw.get("file") or "",
            show_key=str(raw.get("grandparent_rating_key") or ""),
            season=_index(raw, "parent_media_index"),
            episode=_index(raw, "media_index"),
            device=raw.get("device") or "",
            dovi_profile=_int(raw.get("video_dovi_profile")),
            source_bitrate_kbps=_int(raw.get("bitrate")),
            transcode_speed=_float(raw.get("transcode_speed")),
            transcode_throttled=_int(raw.get("transcode_throttled")) == 1,
            tmdb_id=_title_tmdb_id(raw),
        )


@dataclass(frozen=True)
class Activity:
    sessions: tuple[Session, ...]
    stream_count: int
    transcode_count: int
    total_bandwidth_kbps: int
    wan_bandwidth_kbps: int

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> Activity:
        return cls(
            sessions=tuple(Session.from_api(s) for s in raw.get("sessions", [])),
            stream_count=_int(raw.get("stream_count")),
            transcode_count=_int(raw.get("stream_count_transcode")),
            total_bandwidth_kbps=_int(raw.get("total_bandwidth")),
            wan_bandwidth_kbps=_int(raw.get("wan_bandwidth")),
        )


@dataclass(frozen=True)
class HistoryRow:
    user_id: int
    rating_key: str
    full_title: str
    media_type: str
    started: int
    stopped: int
    percent_complete: int
    transcode_decision: str
    platform: str
    player: str
    location: str
    relayed: bool
    row_id: int = 0  # what `stream_data` takes
    product: str = ""
    show_key: str = ""
    season: int | None = None
    episode: int | None = None

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> HistoryRow:
        return cls(
            user_id=_int(raw.get("user_id")),
            rating_key=str(raw.get("rating_key") or ""),
            full_title=raw.get("full_title") or "",
            media_type=raw.get("media_type") or "",
            started=_int(raw.get("started")),
            stopped=_int(raw.get("stopped")),
            percent_complete=_int(raw.get("percent_complete")),
            transcode_decision=raw.get("transcode_decision") or "",
            platform=raw.get("platform") or "",
            player=raw.get("player") or "",
            location=raw.get("location") or "",
            relayed=_int(raw.get("relayed")) == 1,
            row_id=_int(raw.get("row_id")),
            product=raw.get("product") or "",
            show_key=str(raw.get("grandparent_rating_key") or ""),
            season=_index(raw, "parent_media_index"),
            episode=_index(raw, "media_index"),
        )


@dataclass(frozen=True)
class StreamData:
    """What a finished play was sent: the source's codecs and the server's decision on each."""

    container: str
    video_codec: str
    video_decision: str  # "direct play" | "copy" | "transcode"
    audio_codec: str
    audio_decision: str
    subtitle_codec: str
    subtitle_decision: str  # adds "burn"; empty without subtitles
    source_bitrate_kbps: int = 0  # the file's own bitrate
    stream_bitrate_kbps: int = 0  # what it was sent at

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> StreamData:
        return cls(
            container=raw.get("container") or "",
            video_codec=raw.get("video_codec") or "",
            video_decision=raw.get("stream_video_decision") or "",
            audio_codec=raw.get("audio_codec") or "",
            audio_decision=raw.get("stream_audio_decision") or "",
            subtitle_codec=raw.get("subtitle_codec") or "",
            subtitle_decision=raw.get("stream_subtitle_decision") or "",
            source_bitrate_kbps=_int(raw.get("bitrate")),
            stream_bitrate_kbps=_int(raw.get("stream_bitrate")),
        )


@dataclass(frozen=True)
class Metadata:
    """A Plex item as the server that holds it knows it: which title it belongs to."""

    rating_key: str
    tmdb_id: int | None  # the movie's, or an episode's show's; None without a TMDB match

    @classmethod
    def from_api(cls, rating_key: str, raw: dict[str, Any]) -> Metadata:
        return cls(rating_key, _title_tmdb_id(raw))


@dataclass(frozen=True)
class TautulliUser:
    user_id: int
    username: str
    friendly_name: str
    email: str

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> TautulliUser:
        return cls(
            user_id=_int(raw.get("user_id")),
            username=raw.get("username") or "",
            friendly_name=raw.get("friendly_name") or "",
            email=(raw.get("email") or "").lower(),
        )


class Tautulli(Protocol):
    host: str

    async def ping(self) -> None: ...
    async def server_identity(self) -> str: ...
    async def metadata(self, rating_key: str) -> Metadata: ...
    async def activity(self) -> Activity: ...
    async def history(
        self,
        *,
        user_id: int | None = None,
        rating_key: str | None = None,
        after: date | None = None,
        length: int = 10,
    ) -> list[HistoryRow]: ...
    async def stream_data(self, row_id: int) -> StreamData: ...
    async def users(self) -> list[TautulliUser]: ...
    async def recently_added(self, count: int = 25) -> list[dict[str, Any]]: ...


class TautulliClient(HttpClient):
    service = "tautulli"

    def __init__(self, host: str, base_url: str, api_key: str, **kwargs: Any):
        super().__init__(base_url, params={"apikey": api_key}, **kwargs)
        self.host = host

    async def _cmd(self, cmd: str, **params: Any) -> Any:
        data = await self.get_json("/api/v2", params={"cmd": cmd, **params})
        response = data.get("response") or {}
        if response.get("result") != "success":
            raise ClientError(
                self.service, "GET", f"/api/v2?cmd={cmd}", 200, response.get("message") or "error"
            )
        return response.get("data")

    async def ping(self) -> None:
        """Tautulli's own status command, which also checks the API key."""
        await self._cmd("status")

    async def server_identity(self) -> str:
        """The machine identifier of the Plex server this Tautulli watches."""
        data = await self._cmd("get_server_identity") or {}
        identity = data[0] if isinstance(data, list) and data else data
        return str(identity.get("machine_identifier") or "") if isinstance(identity, dict) else ""

    async def metadata(self, rating_key: str) -> Metadata:
        """An item of the Plex server this Tautulli watches, by that server's rating key."""
        data = await self._cmd("get_metadata", rating_key=rating_key) or {}
        return Metadata.from_api(rating_key, data)

    async def activity(self) -> Activity:
        return Activity.from_api(await self._cmd("get_activity") or {})

    async def history(
        self,
        *,
        user_id: int | None = None,
        rating_key: str | None = None,
        after: date | None = None,
        length: int = 10,
    ) -> list[HistoryRow]:
        """Finished plays, newest first: one user's, or one Plex item's, or everyone's, from
        `after` (a day, included) on."""
        params: dict[str, Any] = {"length": length, "order_column": "date", "order_dir": "desc"}
        if user_id is not None:
            params["user_id"] = user_id
        if rating_key is not None:
            params["rating_key"] = rating_key
        if after is not None:
            params["after"] = after.isoformat()
        data = await self._cmd("get_history", **params) or {}
        return [HistoryRow.from_api(r) for r in data.get("data", [])]

    async def stream_data(self, row_id: int) -> StreamData:
        return StreamData.from_api(await self._cmd("get_stream_data", row_id=row_id) or {})

    async def users(self) -> list[TautulliUser]:
        return [TautulliUser.from_api(u) for u in await self._cmd("get_users") or []]

    async def recently_added(self, count: int = 25) -> list[dict[str, Any]]:
        data = await self._cmd("get_recently_added", count=count) or {}
        return list(data.get("recently_added", []))


@dataclass
class FakeTautulliClient(Downable):
    service: ClassVar[str] = "tautulli"
    host: str = "fake"
    plex_id: str = ""  # the machine identifier of the Plex server it watches
    sessions: list[Session] = field(default_factory=list)
    history_rows: list[HistoryRow] = field(default_factory=list)
    # What each history row's play was sent, by row id.
    streams: dict[int, StreamData] = field(default_factory=dict)
    user_list: list[TautulliUser] = field(default_factory=list)
    recent: list[dict[str, Any]] = field(default_factory=list)
    # The title's TMDB id per rating key of its Plex server's items.
    titles: dict[str, int] = field(default_factory=dict)

    async def server_identity(self) -> str:
        self.refuse_if_down("/api/v2?cmd=get_server_identity")
        return self.plex_id

    async def metadata(self, rating_key: str) -> Metadata:
        self.refuse_if_down("/api/v2?cmd=get_metadata")
        return Metadata(rating_key, self.titles.get(rating_key))

    async def activity(self) -> Activity:
        wan = sum(s.bandwidth_kbps for s in self.sessions if s.location == "wan")
        return Activity(
            sessions=tuple(self.sessions),
            stream_count=len(self.sessions),
            transcode_count=sum(1 for s in self.sessions if s.transcode_decision == "transcode"),
            total_bandwidth_kbps=sum(s.bandwidth_kbps for s in self.sessions),
            wan_bandwidth_kbps=wan,
        )

    async def history(
        self,
        *,
        user_id: int | None = None,
        rating_key: str | None = None,
        after: date | None = None,
        length: int = 10,
    ) -> list[HistoryRow]:
        since = datetime.combine(after, datetime.min.time(), UTC).timestamp() if after else 0
        rows = [
            r
            for r in self.history_rows
            if (user_id is None or r.user_id == user_id)
            and (rating_key is None or r.rating_key == rating_key)
            and r.started >= since
        ]
        return sorted(rows, key=lambda r: r.started, reverse=True)[:length]

    async def stream_data(self, row_id: int) -> StreamData:
        return self.streams[row_id]

    async def users(self) -> list[TautulliUser]:
        return list(self.user_list)

    async def recently_added(self, count: int = 25) -> list[dict[str, Any]]:
        return self.recent[:count]
