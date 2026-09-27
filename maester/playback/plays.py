"""A friend's plays on every Tautulli host: what they are watching or just watched.

"This won't play" rarely names the file, so a report starts from what the
friend played. Every host's Tautulli is asked at once for the friend's live
sessions and last few finished plays; a host that can't answer is named
instead of hiding the others. Tautulli knows a Plex item, not a title, so
`identify` reads the item's TMDB id from Plex and asks Seerr for the title,
and `copy_of` tells from Seerr's Plex keys whether the item is the 1080p or
the 4K copy. `playback_of` reads how a play went (`Playback`), for the
player check and for explaining lag: the one place Tautulli's session facts
become a typed model.

Tautulli keeps a play in its history only once it stops and outlasts the
ignore interval, so a play that failed at once may not be here at all; the
friend is then asked for the title.
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass, replace
from typing import Any

from maester.clients import Services
from maester.clients.seerr import MediaDetails
from maester.clients.tautulli import HistoryRow, Session, StreamData, Tautulli
from maester.media import Copy

# Finished plays asked of each host.
RECENT = 5
# Where Tautulli places a friend away from the server's network.
REMOTE = frozenset({"wan", "cellular"})
# Plex's relay carries a stream when the server can't be reached directly, at
# most 2 Mbps, for Plex Pass and free accounts alike
# (support.plex.tv/articles/216766168-accessing-a-server-through-relay/).
RELAY_CAP_KBPS = 2000


@dataclass(frozen=True)
class Playback:
    """One play's facts: the client, what the file holds, what the server did with it,
    and how it travelled (LAN or the internet, Plex's relay, the bitrate sent)."""

    platform: str  # "Roku", "Chrome", "Android"
    product: str  # "Plex for Roku", "Plex Web"
    player: str  # the player's name, often the hardware's: "SHIELD Android TV"
    device: str  # the hardware, from a live session; empty for a finished play
    container: str
    # Tautulli's label for the bitrate a converted video is sent at ("8 Mbps 1080p"), worked
    # out from that bitrate, not what the player asked for; "Original" otherwise.
    quality_profile: str
    transcode_decision: str  # overall: "direct play" | "copy" (direct stream) | "transcode"
    video_codec: str
    video_decision: str  # "direct play" | "copy" | "transcode"
    dovi_profile: int | None  # the file's Dolby Vision profile: 0 for none, None if unknown
    audio_codec: str
    audio_decision: str
    subtitle_codec: str
    subtitle_decision: str  # adds "burn"; empty without subtitles
    location: str  # "lan", or "wan"/"cellular" for a friend away from the server
    relayed: bool  # through Plex's relay, which caps it (`RELAY_CAP_KBPS`)
    bitrate_kbps: int  # what the stream is sent at
    source_bitrate_kbps: int  # the file's own bitrate
    # How fast the server converts it against real time (under 1.0 it can't keep up);
    # None for a finished play, a stream not converted, or one throttled for being ahead.
    transcode_speed: float | None

    @classmethod
    def from_session(cls, s: Session) -> Playback:
        """A live play: Tautulli knows all of it, the file's Dolby Vision profile included."""
        return cls(
            platform=s.platform,
            product=s.product,
            player=s.player,
            device=s.device,
            container=s.container,
            quality_profile=s.quality_profile,
            transcode_decision=s.transcode_decision,
            video_codec=s.video_codec,
            video_decision=s.video_decision,
            dovi_profile=s.dovi_profile,
            audio_codec=s.audio_codec,
            audio_decision=s.audio_decision,
            subtitle_codec=s.subtitle_codec,
            subtitle_decision=s.subtitle_decision,
            location=s.location,
            relayed=s.relayed,
            bitrate_kbps=s.stream_bitrate_kbps,
            source_bitrate_kbps=s.source_bitrate_kbps,
            transcode_speed=(
                s.transcode_speed if s.transcode_speed and not s.transcode_throttled else None
            ),
        )

    @classmethod
    def from_history(cls, row: HistoryRow, stream: StreamData) -> Playback:
        """A finished play: its history row and stream data. Tautulli keeps no Dolby Vision
        profile for it; `with_profile` fills that in from the file."""
        return cls(
            platform=row.platform,
            product=row.product,
            player=row.player,
            device="",
            container=stream.container,
            quality_profile=stream.quality_profile,
            transcode_decision=row.transcode_decision,
            video_codec=stream.video_codec,
            video_decision=stream.video_decision,
            dovi_profile=None,
            audio_codec=stream.audio_codec,
            audio_decision=stream.audio_decision,
            subtitle_codec=stream.subtitle_codec,
            subtitle_decision=stream.subtitle_decision,
            location=row.location,
            relayed=row.relayed,
            bitrate_kbps=stream.stream_bitrate_kbps,
            source_bitrate_kbps=stream.source_bitrate_kbps,
            transcode_speed=None,
        )

    @property
    def hardware(self) -> str:
        """What names the hardware: the device, and the player's name, which often says it."""
        return f"{self.device} {self.player}".lower()

    @property
    def remote(self) -> bool:
        """Away from the server: the stream crosses the internet and the server's upload."""
        return self.location in REMOTE

    @property
    def reduced(self) -> bool:
        """The video is converted to less than the file's own bitrate."""
        return self.video_decision == "transcode" and self.bitrate_kbps < self.source_bitrate_kbps

    @property
    def squeezed(self) -> bool:
        """Cut down to fit a connection, or maybe so: Plex's relay caps it, or it's sent away
        from home at less than the file's bitrate (a remote quality setting, or a player that
        can't decode it; Tautulli can't say which). Either way its conversion says nothing
        certain about the player's codecs. At home, a player gets the file's own quality."""
        return self.relayed or (self.remote and self.reduced)

    def with_profile(self, dovi_profile: int) -> Playback:
        """The file's Dolby Vision profile, where the play didn't say."""
        return self if self.dovi_profile is not None else replace(self, dovi_profile=dovi_profile)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class Play:
    """One play on one host: a live session, or a finished play from the history."""

    host: str
    title: str  # Tautulli's full title, "The Bear - Forks"
    rating_key: str
    show_key: str  # the show's Plex key, for an episode
    season: int | None
    episode: int | None
    player: str  # "Plex for Roku on Living Room"
    started: int  # epoch seconds; 0 while live
    source: Session | HistoryRow

    @property
    def live(self) -> bool:
        return isinstance(self.source, Session)

    @property
    def kind(self) -> str:
        """Seerr's media type: "movie" or "tv"."""
        return "tv" if self.show_key else "movie"

    @property
    def plex_key(self) -> str:
        """The Plex item Seerr knows: the movie, or the episode's show."""
        return self.show_key or self.rating_key

    @classmethod
    def from_session(cls, host: str, s: Session) -> Play:
        return cls(
            host=host,
            title=s.full_title,
            rating_key=s.rating_key,
            show_key=s.show_key,
            season=s.season,
            episode=s.episode,
            player=f"{s.product} on {s.player}",
            started=0,
            source=s,
        )

    @classmethod
    def from_history(cls, host: str, row: HistoryRow) -> Play:
        return cls(
            host=host,
            title=row.full_title,
            rating_key=row.rating_key,
            show_key=row.show_key,
            season=row.season,
            episode=row.episode,
            player=f"{row.product} on {row.player}",
            started=row.started,
            source=row,
        )

    def is_of(self, details: MediaDetails, copy: Copy) -> bool:
        """Whether this play was of that copy (and that episode)."""
        key = details.rating_key_for(copy.is_4k)
        return key == self.plex_key and (self.season, self.episode) == (copy.season, copy.episode)


@dataclass(frozen=True)
class Plays:
    plays: tuple[Play, ...]  # live first, then newest; one per Plex item
    unreachable: dict[str, str]  # host -> why its Tautulli couldn't answer


async def _host_plays(host: str, tautulli: Tautulli, user_id: int) -> list[Play]:
    activity, history = await asyncio.gather(
        tautulli.activity(), tautulli.history(user_id=user_id, length=RECENT)
    )
    live = [Play.from_session(host, s) for s in activity.sessions if s.user_id == user_id]
    return [*live, *(Play.from_history(host, row) for row in history)]


async def recent_plays(services: Services, tautulli_user_id: int) -> Plays:
    hosts = sorted(services.tautulli)
    found = await asyncio.gather(
        *(_host_plays(h, services.tautulli[h], tautulli_user_id) for h in hosts),
        return_exceptions=True,
    )
    plays: list[Play] = []
    unreachable: dict[str, str] = {}
    for host, result in zip(hosts, found, strict=True):
        if isinstance(result, BaseException):
            unreachable[host] = f"{type(result).__name__}: {result}"
        else:
            plays.extend(result)
    plays.sort(key=lambda p: (not p.live, -p.started))
    # One Plex server, so a rating key is one item whichever Tautulli saw it.
    unique: dict[str, Play] = {}
    for play in plays:
        unique.setdefault(play.rating_key, play)
    return Plays(tuple(unique.values()), unreachable)


async def identify(services: Services, play: Play) -> MediaDetails:
    """The title a play was of, through its Plex item's TMDB id."""
    item = await services.plex.item(play.plex_key)
    if item is None or item.tmdb_id is None:
        raise LookupError(f"Plex has no TMDB id for {play.title}")
    return await services.seerr.media_details(play.kind, item.tmdb_id)


def copy_of(details: MediaDetails, plex_key: str) -> bool | None:
    """Whether a Plex item is the 4K copy (True) or the 1080p one (False); None when unclear.

    Seerr keeps a Plex key per copy. When both copies are one Plex item (or
    neither key is this one), the play alone can't say which it was.
    """
    standard, uhd = plex_key == details.rating_key, plex_key == details.rating_key_4k
    return None if standard == uhd else uhd


async def playback_of(services: Services, play: Play) -> Playback:
    """How a play went: a live session says it all; a finished play's streams are read
    by its history row."""
    match play.source:
        case Session() as live:
            return Playback.from_session(live)
        case HistoryRow() as row:
            stream = await services.tautulli[play.host].stream_data(row.row_id)
            return Playback.from_history(row, stream)
