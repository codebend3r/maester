"""A title's versions on Plex with their bitrates, and which one a connection carries.

A movie can sit on Plex as several versions: its standard copy's 1080p
file, its 4K copy's remux, and the server's own HEVC re-encode of it. Each
is a Media entry (`plex.Version`) of the Plex item holding its copy, and
friends name them "1080p", "4K" and "4K HEVC re-encode" (`version_name`).
`title_versions` lists every one, from both copies' items.

A connection is the tightest limit known on it (`Connection`), each limit
saying where it came from: the speed the friend gives, Plex's relay, the
quality their player asked for the last time they played away from home,
the servers' free upload at the last speed test. A version fits when its
average bitrate, allowing `PEAK_ALLOWANCE` for the busy scenes a file
spikes through, stays under the limit. `recommend` picks the best version
that fits, or else the lightest, with the remote quality to set so Plex
converts it down (`quality_for`, Plex's own quality steps). With nothing
known, a connection away from home is taken to carry about
`REMOTE_COMFORT_KBPS` (`or_typical`), and says so.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from maester.clients.plex import Plex, PlexItem, Version
from maester.clients.seerr import MediaDetails
from maester.formatting import megabits
from maester.perf.load import mbps
from maester.perf.uplink import Uplink
from maester.playback.plays import RELAY_CAP_KBPS, Playback

# A stream needs about this much more than a file's average bitrate to get
# through its busiest scenes without buffering.
PEAK_ALLOWANCE = 1.5
# Roughly what a connection away from home carries smoothly when nothing is
# measured: a stream sending more is likely what lags.
REMOTE_COMFORT_KBPS = 20_000
# The remote qualities a Plex app offers under Original, best first, in kbps.
PLEX_QUALITIES = (
    (20_000, "20 Mbps 1080p"),
    (12_000, "12 Mbps 1080p"),
    (10_000, "10 Mbps 1080p"),
    (8_000, "8 Mbps 1080p"),
    (4_000, "4 Mbps 720p"),
    (3_000, "3 Mbps 720p"),
    (2_000, "2 Mbps 720p"),
    (1_500, "1.5 Mbps 480p"),
    (720, "720 kbps"),
)
# The server's own 4K re-encodes are written next to the original as
# "<Movie> (<year>) 2160p HEVC.mkv"; that exact tail is what sets them apart
# from a download whose name merely mentions HEVC ("... Bluray-2160p HEVC").
_REENCODE = re.compile(r"\(\d{4}\) 2160p HEVC\.\w+$", re.IGNORECASE)
_QUALITY = re.compile(r"([\d.]+)\s*(Mbps|kbps)", re.IGNORECASE)


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


def quality_for(kbps: int) -> str:
    """The best Plex remote quality within a limit. Plex caps a converted stream at its
    quality's bitrate, so unlike a file played as it is, it needs no room for peaks."""
    return next((name for step, name in PLEX_QUALITIES if step <= kbps), PLEX_QUALITIES[-1][1])


def asked_kbps(quality_profile: str) -> int | None:
    """The bitrate in a quality a player asked for ("4 Mbps 720p"); None for Original."""
    match = _QUALITY.search(quality_profile)
    if match is None:
        return None
    value, unit = float(match[1]), match[2].lower()
    return round(value * (1000 if unit == "mbps" else 1))


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

    @property
    def needs_kbps(self) -> int:
        return round(self.bitrate_kbps * PEAK_ALLOWANCE)

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


@dataclass(frozen=True)
class Limit:
    kbps: int
    source: str  # where it came from, in words


# What a connection away from home is taken to carry when nothing is measured.
TYPICAL_AWAY = Limit(REMOTE_COMFORT_KBPS, "what most connections away from home carry smoothly")


@dataclass(frozen=True)
class Connection:
    """What's known to limit a friend's stream; the tightest limit is the one that counts."""

    limits: tuple[Limit, ...]

    def or_typical(self) -> Connection:
        """This connection, or a typical one away from home when nothing is known."""
        return self if self.limits else Connection((TYPICAL_AWAY,))

    @property
    def tightest(self) -> Limit | None:
        return min(self.limits, key=lambda limit: limit.kbps, default=None)

    @classmethod
    def of(
        cls,
        *,
        said_mbps: float | None = None,
        last_away: Playback | None = None,
        uplink: Uplink | None = None,
    ) -> Connection:
        """From what the friend says, their last play away from home, and the last speed
        test's free upload."""
        limits = []
        if said_mbps:
            limits.append(Limit(round(said_mbps * 1000), f"you said about {said_mbps:g} Mbps"))
        if last_away is not None and last_away.relayed:
            cap = megabits(RELAY_CAP_KBPS)
            limits.append(
                Limit(RELAY_CAP_KBPS, f"Plex relayed your last stream, at most {cap} Mbps")
            )
        if last_away is not None and (asked := asked_kbps(last_away.quality_profile)):
            said = last_away.quality_profile
            limits.append(Limit(asked, f"your Plex app asked for {said} last time"))
        if uplink is not None:
            limits.append(Limit(uplink.spare_kbps, "the servers' free upload at the last test"))
        return cls(tuple(limits))


@dataclass(frozen=True)
class Pick:
    version: TitleVersion
    fits: bool  # False: nothing fits, so this is the lightest, turned down to `quality`
    limit: Limit

    @property
    def quality(self) -> str:
        """The remote quality to set: Original when it fits, else what the limit carries."""
        return "Original" if self.fits else quality_for(self.limit.kbps)


def recommend(versions: Iterable[TitleVersion], connection: Connection) -> Pick | None:
    """The best version the connection carries, else the lightest; None with no limit known."""
    versions, limit = list(versions), connection.tightest
    if not versions or limit is None:
        return None
    fitting = [v for v in versions if v.needs_kbps <= limit.kbps]
    if fitting:
        return Pick(max(fitting, key=lambda v: v.bitrate_kbps), True, limit)
    return Pick(min(versions, key=lambda v: v.bitrate_kbps), False, limit)
