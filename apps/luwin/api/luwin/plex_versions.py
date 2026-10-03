"""A title's versions on Plex: what friends call each, its bitrate and its size.

A movie can sit on Plex as several versions: its standard copy's 1080p file,
its 4K copy's remux, and the server's own HEVC re-encode of it. Each is a
Media entry (`plex.Version`) of the Plex item holding its copy, and friends
name them "1080p", "4K" and "4K HEVC re-encode" (`version_name`).
`check_availability` lists them; the performance tools weigh them against a
connection (`luwin/perf/versions.py`). They're read from the Plex server
luwin reads (`PLEX_URL`), by Seerr's rating keys, which name items on that
server only (`playback/plays.py`'s `library_hosts`).
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Any

from luwin.clients.plex import Plex, PlexItem, Version
from luwin.clients.seerr import MediaDetails
from luwin.formatting import mbps

# The server's own 4K re-encodes are written next to the original as
# "<Movie> (<year>) 2160p HEVC.mkv"; that exact tail is what sets them apart
# from a download whose name merely mentions HEVC ("... Bluray-2160p HEVC").
_REENCODE = re.compile(r"\(\d{4}\) 2160p HEVC\.\w+$", re.IGNORECASE)


def version_name(version: Version) -> str:
    """How a friend would name a version: "1080p", "4K", or "4K HEVC re-encode"."""
    if _REENCODE.search(version.file):
        return "4K HEVC re-encode"
    return {"4k": "4K", "sd": "SD"}.get(version.resolution.lower(), f"{version.resolution}p")


def describe_version(version: Version) -> dict[str, Any]:
    return {
        "version": version_name(version),
        "codec": version.video_codec,
        "size_gb": round(version.size_bytes / 1e9, 1),
        "bitrate_mbps": mbps(version.bitrate_kbps),
    }


@dataclass(frozen=True)
class TitleVersion:
    """One version of a title, and the Plex item (the standard or 4K copy) holding it."""

    rating_key: str
    version: Version

    @property
    def name(self) -> str:
        return version_name(self.version)

    @property
    def bitrate_kbps(self) -> int:
        return self.version.bitrate_kbps

    def as_dict(self) -> dict[str, Any]:
        return describe_version(self.version)


async def items_of(plex: Plex, details: MediaDetails) -> list[PlexItem]:
    """The Plex items holding the title's copies (standard, then 4K) that Plex still has."""
    keys = list(dict.fromkeys(k for k in (details.rating_key, details.rating_key_4k) if k))
    return [item for item in await asyncio.gather(*map(plex.item, keys)) if item is not None]


async def title_versions(plex: Plex, details: MediaDetails) -> list[TitleVersion]:
    return [
        TitleVersion(item.rating_key, version)
        for item in await items_of(plex, details)
        for version in item.versions
    ]
