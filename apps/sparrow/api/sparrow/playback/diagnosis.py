"""How each kind of report is diagnosed, and what each diagnosis found.

A report kind names one strategy (`reports.POLICIES`), and each strategy
returns its own result, so nothing downstream rediscovers which check ran:

- `file_check` decodes the file around the moment the friend named, or its
  start, middle and end (`FileChecked`). raven converts on the fly what a
  player can't play as it is, so a file that won't play is checked itself.
- `track_listing` reads the file's audio and subtitle tracks (`TrackList`).
- `by_their_word` measures nothing: a cam or the wrong movie plays fine
  (`TheirWord`).

A file that can't be read is a `FileChecked` whose health is `unreadable`.
Each result says what it found in a line (`summary`), as data for the model
(`as_dict`), and in the Seerr issue's closing lines (`details`).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sparrow.clients import Services
from sparrow.clients.media import Inspection, MediaProbe, Track, Unreadable
from sparrow.playback import tracks
from sparrow.playback.health import Health, check_health
from sparrow.playback.items import LocatedFile


@dataclass(frozen=True)
class Case:
    """What a diagnosis works from."""

    services: Services
    located: LocatedFile
    at: float | None  # the moment the friend named, in seconds


@dataclass(frozen=True)
class FileChecked:
    """The file's health."""

    health: Health

    def summary(self) -> str:
        return f"File check: {self.health.summary}."

    def as_dict(self) -> dict[str, Any]:
        return {"file_check": self.health.as_dict()}

    def details(self) -> list[str]:
        return []


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


Diagnosis = FileChecked | TrackList | TheirWord
Diagnose = Callable[[Case], Awaitable[Diagnosis]]


async def inspect(probe: MediaProbe, located: LocatedFile) -> Inspection | Health:
    """ffprobe's read of the file, or its `unreadable` health."""
    try:
        return await probe.inspect(located.file.path)
    except Unreadable as exc:
        return Health.unreadable(exc)


async def file_check(case: Case) -> FileChecked:
    """The file's health: decoded where it was said to break, or at its start, middle, end."""
    match await inspect(case.services.probe, case.located):
        case Health() as unreadable:
            return FileChecked(unreadable)
        case Inspection() as inspection:
            probe, located = case.services.probe, case.located
            return FileChecked(
                await check_health(probe, inspection, at=case.at, expected=located.runtime)
            )


async def read_tracks(probe: MediaProbe, located: LocatedFile) -> TrackList | FileChecked:
    """The file's tracks, or its `unreadable` health."""
    match await inspect(probe, located):
        case Inspection() as inspection:
            return TrackList(inspection.tracks)
        case Health() as unreadable:
            return FileChecked(unreadable)


async def track_listing(case: Case) -> TrackList | FileChecked:
    return await read_tracks(case.services.probe, case.located)


async def by_their_word(case: Case) -> TheirWord:
    return TheirWord()
