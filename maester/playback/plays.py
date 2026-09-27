"""A friend's plays on every Tautulli host: what they are watching or just watched.

"This won't play" rarely names the file, so a report starts from what the
friend played. Every host's Tautulli is asked at once for the friend's live
sessions and last few finished plays; a host that can't answer is named
instead of hiding the others. Tautulli knows a Plex item, not a title, so
`identify` reads the item's TMDB id from Plex and asks Seerr for the title,
and `copy_of` tells from Seerr's Plex keys whether the item is the 1080p or
the 4K copy. `playback_of` reads how a play went, for the client check.

Tautulli keeps a play in its history only once it stops and outlasts the
ignore interval, so a play that failed at once may not be here at all; the
friend is then asked for the title.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from maester.clients import Services
from maester.clients.seerr import MediaDetails
from maester.clients.tautulli import HistoryRow, Session, Tautulli
from maester.media import Copy
from maester.playback.client_limits import Playback

# Finished plays asked of each host.
RECENT = 5


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


async def playback_of(services: Services, play: Play, file_dovi_profile: int | None) -> Playback:
    """How a play went. A live session says it all; a finished play's streams are read
    by its history row, and its Dolby Vision profile comes from the file."""
    match play.source:
        case Session() as live:
            return Playback.from_session(live)
        case HistoryRow() as row:
            stream = await services.tautulli[play.host].stream_data(row.row_id)
            return Playback.from_history(row, stream, file_dovi_profile)
