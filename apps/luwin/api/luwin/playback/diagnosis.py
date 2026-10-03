"""How each kind of report is diagnosed, and what each diagnosis found.

A report kind names one strategy (`reports.POLICIES`), and each strategy
returns its own result, so nothing downstream rediscovers which check ran:

- `player_then_file` reads the friend's latest play of the copy and the
  file at once. A known player limit (`client_limits.py`) is the answer
  (`PlayerLimit`); only without one is the file's health checked
  (`FileChecked`). A friend who already got a player fix for this file is
  checked with `file_only` instead, so a fix can't shield a broken file.
- `track_listing` reads the file's audio and subtitle tracks (`TrackList`).
- `by_their_word` measures nothing: a cam or the wrong movie plays fine
  (`TheirWord`).

A file that can't be read is a `FileChecked` whose health is `unreadable`.
Each result says what it found in a line (`summary`), as data for the model
(`as_dict`), and in the Seerr issue's closing lines (`details`).
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from typing import Any

from luwin.clients import ClientError, Services
from luwin.clients.media import Inspection, MediaProbe, Track, Unreadable
from luwin.playback import tracks
from luwin.playback.client_limits import ClientLimit, client_causes
from luwin.playback.health import Health, check_health
from luwin.playback.items import LocatedFile
from luwin.playback.plays import Play, Playback, playback_of, recent_plays
from luwin.store import LinkedUser


@dataclass(frozen=True)
class Case:
    """What a diagnosis works from."""

    services: Services
    link: LinkedUser
    located: LocatedFile
    at: float | None  # the moment the friend named, in seconds


@dataclass(frozen=True)
class PlayerCheck:
    """The play the player check read, or why it read none."""

    play: Play | None
    why_not: str = ""
    playback: Playback | None = None

    @property
    def causes(self) -> tuple[ClientLimit, ...]:
        return client_causes(self.playback) if self.playback else ()

    def describe(self) -> str:
        if self.play is None:
            return f"not checked: {self.why_not}"
        when = "playing now" if self.play.live else "their last play"
        return f"{when}, {self.play.player} (Tautulli on {self.play.host})"

    def with_file(self, inspection: Inspection) -> PlayerCheck:
        """The file's Dolby Vision profile, where the play didn't say."""
        if self.playback is None:
            return self
        return replace(self, playback=self.playback.with_profile(inspection.dovi_profile))

    def as_dict(self) -> dict[str, Any]:
        facts: dict[str, Any] = {"player_check": self.describe()}
        if self.playback:
            facts["playback"] = self.playback.as_dict()
        return facts


@dataclass(frozen=True)
class PlayerLimit:
    """The player explains it; the file is left alone."""

    check: PlayerCheck
    causes: tuple[ClientLimit, ...]

    health = None

    def summary(self) -> str:
        return " ".join(f"Player limit: {c.cause} Fix: {c.fix}" for c in self.causes)

    def as_dict(self) -> dict[str, Any]:
        return {**self.check.as_dict(), "player_causes": [c.as_dict() for c in self.causes]}

    def details(self) -> list[str]:
        return [f"Player: {self.check.describe()}"]


@dataclass(frozen=True)
class FileChecked:
    """The file's health, and the player check that came first, when one did."""

    check: PlayerCheck | None
    health: Health

    def summary(self) -> str:
        return f"File check: {self.health.summary}."

    def as_dict(self) -> dict[str, Any]:
        found = self.check.as_dict() if self.check else {}
        return {**found, "file_check": self.health.as_dict()}

    def details(self) -> list[str]:
        return [f"Player: {self.check.describe()}"] if self.check else []


@dataclass(frozen=True)
class TrackList:
    """The file's audio and subtitle tracks."""

    tracks: tuple[Track, ...]

    health = None

    def summary(self) -> str:
        return f"The file has {len(self.tracks)} audio and subtitle tracks (listed below)."

    def as_dict(self) -> dict[str, Any]:
        return {"tracks": tracks.listing(self.tracks)}

    def details(self) -> list[str]:
        return ["Tracks:", *(f"- {line}" for line in tracks.lines(self.tracks))]


@dataclass(frozen=True)
class TheirWord:
    """Nothing measured: the report itself is the evidence."""

    health = None

    def summary(self) -> str:
        return "Nothing to measure; the report itself is the evidence."

    def as_dict(self) -> dict[str, Any]:
        return {}

    def details(self) -> list[str]:
        return []


Diagnosis = PlayerLimit | FileChecked | TrackList | TheirWord
Diagnose = Callable[[Case], Awaitable[Diagnosis]]


async def inspect(probe: MediaProbe, located: LocatedFile) -> Inspection | Health:
    """ffprobe's read of the file, or its `unreadable` health."""
    try:
        return await probe.inspect(located.file.path)
    except Unreadable as exc:
        return Health.unreadable(exc)


async def player_check(case: Case) -> PlayerCheck:
    """The friend's latest play of this copy, read for the player check."""
    services, link, located = case.services, case.link, case.located
    if link.tautulli_user_id is None:
        return PlayerCheck(None, "their Plex account isn't matched to a Tautulli user")
    found = await recent_plays(services, link.tautulli_user_id)
    play = found.play_of(located.details, located.copy)
    if play is None:
        return PlayerCheck(None, "no recent play of this copy in Tautulli")
    try:
        return PlayerCheck(play, playback=await playback_of(services, play))
    except ClientError as exc:
        return PlayerCheck(None, f"Tautulli on {play.host} couldn't say how it played ({exc})")


async def file_health(case: Case, inspected: Inspection | Health) -> Health:
    match inspected:
        case Health():
            return inspected
        case Inspection():
            probe, located = case.services.probe, case.located
            return await check_health(probe, inspected, at=case.at, expected=located.runtime)


async def player_then_file(case: Case) -> PlayerLimit | FileChecked:
    """The player first; the file's health only when no player limit explains it."""
    inspected, check = await asyncio.gather(
        inspect(case.services.probe, case.located), player_check(case)
    )
    match inspected:
        case Inspection():
            check = check.with_file(inspected)
    if causes := check.causes:
        return PlayerLimit(check, causes)
    return FileChecked(check, await file_health(case, inspected))


async def file_only(case: Case) -> FileChecked:
    """The file's health, for a friend who already had a player fix for this file."""
    inspected = await inspect(case.services.probe, case.located)
    skipped = PlayerCheck(
        None, "they already had a player fix for this file, so the file is checked"
    )
    return FileChecked(skipped, await file_health(case, inspected))


async def read_tracks(probe: MediaProbe, located: LocatedFile) -> TrackList | FileChecked:
    """The file's tracks, or its `unreadable` health."""
    match await inspect(probe, located):
        case Inspection() as inspection:
            return TrackList(inspection.tracks)
        case Health() as unreadable:
            return FileChecked(None, unreadable)


async def track_listing(case: Case) -> TrackList | FileChecked:
    return await read_tracks(case.services.probe, case.located)


async def by_their_word(case: Case) -> TheirWord:
    return TheirWord()
