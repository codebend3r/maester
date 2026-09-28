"""A file's audio and subtitle tracks, as a friend (or a Seerr issue) should read them.

ffprobe's tracks (`maester/clients/media.py`) answer "does this have Spanish
subs?" and go into subtitle and audio reports. Each audio track says
whether it is English by the dub audit's rules (`maester/dub.py`), title
rule included.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from maester.clients.media import Track
from maester.dub import is_english_track


def _flags(track: Track) -> list[str]:
    named = (("default", track.default), ("forced", track.forced), ("file", track.external))
    return [name for name, on in named if on]


def describe(track: Track) -> dict[str, Any]:
    described: dict[str, Any] = {"language": track.language or "untagged", "codec": track.codec}
    if track.title:
        described["title"] = track.title
    if track.kind == "audio":
        described["channels"] = track.channels
        described["english"] = is_english_track(track.language, track.title)
    if flags := _flags(track):
        described["flags"] = flags
    return described


def listing(tracks: Iterable[Track]) -> dict[str, list[dict[str, Any]]]:
    tracks = list(tracks)
    return {
        "audio": [describe(t) for t in tracks if t.kind == "audio"],
        "subtitles": [describe(t) for t in tracks if t.kind == "subtitle"],
    }


def lines(tracks: Iterable[Track]) -> list[str]:
    """One line per track, for a Seerr issue: "audio: spa ac3 6ch (default)"."""
    out = []
    for track in tracks:
        channels = f" {track.channels}ch" if track.channels else ""
        title = f' "{track.title}"' if track.title and not track.external else ""
        flags = f" ({', '.join(_flags(track))})" if _flags(track) else ""
        language = track.language or "untagged"
        out.append(f"{track.kind}: {language} {track.codec}{channels}{title}{flags}")
    return out
