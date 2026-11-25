"""Which of a title's files a connection carries, and the size to convert to when none does.

A movie can sit in raven as several files (a 1080p copy, a 4K remux, a cut
of its own), each one of the item's `versions` (`RavenItem.files`), named as
friends name them (`RavenFile.name`). A connection is what's known to limit
a friend's stream (`Connection`), each limit saying where it came from: the
speed the friend gives, and the servers' free upload at the last speed test,
plus the share of it their own stream takes when one is playing. A file fits
when its average bitrate, allowing `PEAK_ALLOWANCE` for the busy scenes a
file spikes through, stays under the tightest limit (`best_fitting`).
`recommend` picks the best file that fits, or else the lightest, with the
size to pick in raven's player (its Quality menu converts to one of raven's
own sizes, `RAVEN_QUALITIES`, and holds the stream to its bitrate).

With nothing known, a connection away from home is taken to carry about
`REMOTE_COMFORT_KBPS` (`TYPICAL_AWAY`), and the reply says so. A stream
already lagging away from home is weighed against that typical connection
as well as what's known, since its own connection is what isn't.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
from dataclasses import dataclass

from sparrow.clients import ClientError
from sparrow.clients.raven import Raven, RavenFile, RavenItem
from sparrow.clients.seerr import MediaDetails
from sparrow.perf.uplink import Uplink

# A stream needs about this much more than a file's average bitrate to get
# through its busiest scenes without buffering.
PEAK_ALLOWANCE = 1.5
# Roughly what a connection away from home carries smoothly when nothing is
# measured: a stream sending more is likely what lags.
REMOTE_COMFORT_KBPS = 20_000
# The sizes raven's player converts to (`STREAM_QUALITIES` in @raven/core's streaming
# contract), best first: raven's key, the player's label, and the bitrate it holds, in kbps.
RAVEN_QUALITIES = (
    ("high1080", "1080p HD (High)", 20_000),
    ("medium1080", "1080p HD (Medium)", 12_000),
    ("standard1080", "1080p HD (Standard)", 10_000),
    ("low1080", "1080p HD (Low)", 8_000),
    ("high720", "720p HD (High)", 4_000),
    ("medium720", "720p HD (Medium)", 3_000),
    ("low720", "720p HD", 2_000),
    ("sd480", "480p", 1_500),
    ("mobile328", "328p", 700),
)


def quality_for(kbps: int) -> str:
    """The best size raven converts to within a limit, as its player labels it. A converted
    stream is held to its size's bitrate, so unlike a file played as it is, it needs no
    room for peaks."""
    return next(
        (label for _, label, step in RAVEN_QUALITIES if step <= kbps), RAVEN_QUALITIES[-1][1]
    )


def quality_label(key: str | None) -> str | None:
    """The player's label for a size raven names by its key."""
    return next((label for k, label, _ in RAVEN_QUALITIES if k == key), None)


def needs_kbps(bitrate_kbps: int) -> int:
    """What a connection must carry to play a file of that bitrate as it is, peaks included."""
    return round(bitrate_kbps * PEAK_ALLOWANCE)


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

    @classmethod
    def of(
        cls,
        *,
        said_mbps: float | None = None,
        uplink: Uplink | None = None,
        streaming_kbps: int = 0,
    ) -> Connection:
        """From the speed the friend gives and the last speed test's free upload, plus
        `streaming_kbps`, the share of the upload their stream playing now already takes
        (the test ran alongside it)."""
        limits = []
        if said_mbps:
            limits.append(Limit(round(said_mbps * 1000), f"you said about {said_mbps:g} Mbps"))
        if uplink is not None:
            source = "the servers' free upload at the last test"
            if streaming_kbps:
                source += ", with what your stream already takes"
            limits.append(Limit(uplink.spare_kbps + streaming_kbps, source))
        return cls(tuple(limits))

    def limit(self, *, lagging_away: bool = False) -> Limit:
        """The tightest known limit, or a typical connection away from home when none is
        known. A stream `lagging_away` counts the typical connection among the limits."""
        typical = (TYPICAL_AWAY,) if lagging_away or not self.limits else ()
        return min((*self.limits, *typical), key=lambda limit: limit.kbps)


def probed(files: Iterable[RavenFile]) -> list[RavenFile]:
    """The files whose bitrate raven knows: the only ones a connection can be weighed for."""
    return [f for f in files if f.bitrate_kbps]


def _kbps(file: RavenFile) -> int:
    return file.bitrate_kbps or 0


def best_fitting(files: Iterable[RavenFile], limit: Limit | None) -> RavenFile | None:
    """The best file a limit carries as it is, peaks included; any with no limit (a home
    network carries any file); None when none fits."""
    fitting = [f for f in probed(files) if limit is None or needs_kbps(_kbps(f)) <= limit.kbps]
    return max(fitting, key=_kbps, default=None)


@dataclass(frozen=True)
class Pick:
    file: RavenFile
    fits: bool  # False: nothing fits, so this is the lightest, converted down to `quality`
    limit: Limit

    @property
    def quality(self) -> str:
        """What to pick in the player's Quality menu: the original when it fits, else the size
        the limit carries."""
        return (
            "Play original quality" if self.fits else f"Convert to {quality_for(self.limit.kbps)}"
        )


def recommend(files: Iterable[RavenFile], limit: Limit) -> Pick | None:
    """The best file within the limit, else the lightest; None with none probed."""
    known = probed(files)
    if not known:
        return None
    if (fitting := best_fitting(known, limit)) is not None:
        return Pick(fitting, True, limit)
    return Pick(min(known, key=_kbps), False, limit)


async def _item(raven: Raven, item_id: int) -> RavenItem | None:
    try:
        return await raven.item(item_id)
    except ClientError:  # one candidate raven can't open doesn't hide the rest
        return None


async def item_for(raven: Raven, details: MediaDetails) -> RavenItem | None:
    """The movie raven holds as Seerr's title: searched by its title, and the match whose TMDB
    id is the title's; None when raven holds no copy the viewer may see."""
    found = await raven.search(details.title)
    candidates = dict.fromkeys(
        t.item_id for t in found if t.kind == "movie" and t.item_id is not None
    )
    items = await asyncio.gather(*(_item(raven, item_id) for item_id in candidates))
    return next((i for i in items if i is not None and i.tmdb_id == details.tmdb_id), None)
