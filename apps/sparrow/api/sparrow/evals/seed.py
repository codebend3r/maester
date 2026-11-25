"""What an eval case's `services` block may say, checked when the case loads.

Every block forbids keys it doesn't know, so a misspelled seed fails the
case instead of quietly falling back to a default. Defaults here are what a
case gets when it leaves a field out. Sizes are in GB and bitrates in Mbps,
as the cases write them.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from sparrow.clients.arr_library import ArrService
from sparrow.clients.seerr import MediaStatus
from sparrow.media import MediaType

DEFAULT_HOSTS = ["meleys", "vermithor"]


class Block(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SeasonSeed(Block):
    number: int
    episodes: int
    status: MediaStatus = MediaStatus.UNKNOWN


class TitleSeed(Block):
    """One title: both what search finds and what the details lookup returns."""

    tmdb_id: int
    title: str
    media_type: MediaType = MediaType.MOVIE
    status: MediaStatus = MediaStatus.UNKNOWN
    status_4k: MediaStatus = MediaStatus.UNKNOWN
    year: int | None = None
    overview: str = ""
    poster_path: str | None = None
    # The title's id in the 4K Radarr or Sonarr (`four_k` seeds those).
    arr_4k: int | None = None
    media_id: int | None = None
    runtime: int | None = None
    tvdb_id: int | None = None
    collection_id: int | None = None
    seasons: list[SeasonSeed] = []
    keywords: list[int] = []
    genres: list[int] = []
    original_language: str = ""


class RequestSeed(Block):
    tmdb_id: int
    status: Literal["approved", "pending"] = "approved"
    media_type: MediaType = MediaType.MOVIE
    is_4k: bool = False


class CollectionSeed(Block):
    id: int
    name: str
    parts: list[int]


class SeerrUserSeed(Block):
    id: int
    email: str = ""
    username: str = ""


class SeerrSeed(Block):
    results: list[TitleSeed] = []
    collections: list[CollectionSeed] = []
    users: list[SeerrUserSeed] = []
    requests: list[RequestSeed] = []
    four_k: bool = False
    auto_approve: bool = False


class RadarrFileSeed(Block):
    id: int
    movie_id: int
    path: str = ""
    size_gb: float = 1
    quality: str = "WEBDL-1080p"
    release_group: str | None = None
    season: int | None = None
    # Sonarr's "jpn/eng" form.
    audio: str | None = None


class SonarrFileSeed(Block):
    series_id: int
    id: int | None = None  # its place in the list when left out
    path: str = ""
    size_gb: float = 1
    quality: str = "WEBDL-1080p"
    release_group: str | None = None
    season: int | None = None
    audio: str | None = None


class HistoryEventSeed(Block):
    movie_id: int
    event: str = "grabbed"
    release: str = ""
    when: str = ""
    download_id: str | None = None
    why: str = ""
    indexer: str = ""


class MovieSeed(Block):
    id: int
    title: str
    tmdb_id: int
    year: int | None = None


class QueueSeed(Block):
    movie_id: int
    size_gb: float
    left_gb: float
    title: str = ""
    status: str = "downloading"
    time_left: str | None = None
    messages: list[str] = []
    download_id: str | None = None
    tracked_status: str = "ok"


class RadarrSeed(Block):
    history: list[HistoryEventSeed] = []
    files: list[RadarrFileSeed] = []
    movies: list[MovieSeed] = []
    queue: list[QueueSeed] = []


class SabDownloadSeed(Block):
    nzo_id: str
    name: str = ""
    status: str = "Failed"
    why: str | None = None
    steps: list[str] = []


class SabnzbdSeed(Block):
    history: list[SabDownloadSeed] = []


class SeriesSeed(Block):
    id: int
    title: str
    tvdb_id: int
    year: int | None = None
    type: str = "standard"
    seasons: list[int] = []


class EpisodeSeed(Block):
    id: int
    series_id: int
    season: int
    number: int
    title: str = ""
    file_id: int | None = None
    monitored: bool = True
    aired: str | None = None


class SonarrSeed(Block):
    series: list[SeriesSeed] = []
    files: list[SonarrFileSeed] = []
    episodes: list[EpisodeSeed] = []


class TrackSeed(Block):
    kind: str
    codec: str
    language: str = ""
    title: str = ""
    forced: bool = False
    channels: int = 0


class ProbeFileSeed(Block):
    duration: float = 3600
    video_codec: str = "h264"
    dovi_profile: int = 0
    tracks: list[TrackSeed] = []


class ProbeSeed(Block):
    files: dict[str, ProbeFileSeed] = {}
    # What decoding each file prints, by path.
    errors: dict[str, list[str]] = {}


class VitalsSeed(Block):
    cpu: float | None = None
    memory: float | None = None


class SpeedSeed(Block):
    """What a speed test from `host` finds; without `upload_mbps` it fails."""

    host: str = "meleys"
    upload_mbps: float | None = None
    download_mbps: float = 300
    ping_ms: float = 9
    server: str = "Speedtest, Toronto, ON"
    isp: str = "Home ISP"


class RavenTitleSeed(Block):
    title: str
    library_id: int = 1
    library: str = "Movies"
    kind: str = "movie"
    year: int | None = None
    item_id: int | None = None  # its place in the list when left out
    quality: str | None = None
    hdr: bool = False
    episodes: int | None = None
    released: str | None = None


class WorkSeed(Block):
    title: str
    kind: str = "movie"
    released: str | None = None
    department: str = "acting"
    role: str | None = None


class PersonSeed(Block):
    name: str
    known_for: str | None = None
    works: list[WorkSeed] = []


class RavenFileSeed(Block):
    """One file raven holds; unset fields read as a 1080p H.264 file at 10 Mbps."""

    id: int
    width: int = 1920
    codec: str = "h264"
    hdr: bool = False
    dolby_vision: int | None = None
    bitrate_mbps: float = 10
    size_gb: float = 10
    variant: str | None = None


class RavenItemSeed(Block):
    """A movie, show or episode raven matched, with its TMDB id and its files."""

    id: int
    title: str
    kind: Literal["movie", "show", "episode"] = "movie"
    year: int | None = None
    tmdb_id: int | None = None
    files: list[RavenFileSeed] = []


class RavenPlaySeed(Block):
    """One of the eval user's plays in raven, newest first in the list; an episode names
    its show."""

    media_id: int
    title: str
    item_id: int | None = None
    show: str | None = None
    show_id: int | None = None
    season: int | None = None
    episode: int | None = None
    days_ago: float = 0
    library: str = "Movies"


class RavenStreamSeed(Block):
    """A live stream of one of the items' files; unset fields read as a play as it is, at
    home, in Chrome on a Mac."""

    item_id: int
    media_id: int
    mode: Literal["direct", "remux", "transcode"] = "direct"
    address: str = "192.168.50.20"
    device: str = "Mac"
    browser: str = "Chrome 141"
    send_mbps: float | None = None
    quality: str | None = None
    library: str = "Movies"
    mine: bool = True  # the eval user's, or someone else's that only the admin sees


class RavenSeed(Block):
    titles: list[RavenTitleSeed] = []
    people: list[PersonSeed] = []
    items: list[RavenItemSeed] = []
    plays: list[RavenPlaySeed] = []
    streams: list[RavenStreamSeed] = []


class FilterSeed(Block):
    label: str
    type: str = ""
    # The rules as the arr saves them: its own records' shape, so they stay as given.
    filters: list[dict[str, Any]]


class ArrLibrarySeed(Block):
    # The arr's own records, as its API gives them.
    records: list[dict[str, Any]] = []
    filters: list[FilterSeed] = []
    roots: list[str] = []


class UserSeed(Block):
    seerr_user_id: int = 4
    email: str = "eval@example.com"


class Seed(Block):
    """A case's world: each service's fake, by host where there are several."""

    hosts: list[str] = Field(default_factory=lambda: list(DEFAULT_HOSTS))
    seerr: SeerrSeed = SeerrSeed()
    radarr: dict[str, RadarrSeed] = {}
    sonarr: dict[str, SonarrSeed] = {}
    sabnzbd: dict[str, SabnzbdSeed] = {}
    probe: ProbeSeed = ProbeSeed()
    fleet: dict[str, VitalsSeed] | None = None
    speedtest: SpeedSeed | None = None
    raven: RavenSeed = RavenSeed()
    arr_libraries: dict[ArrService, dict[str, ArrLibrarySeed]] = {}
    # Services that answer like unreachable ones: "raven", or "radarr:vermithor" per host.
    down: list[str] = []
    user: UserSeed = UserSeed()
