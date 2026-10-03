"""Which of a title's versions a connection carries.

A connection is what's known to limit a friend's stream (`Connection`),
each limit saying where it came from: the speed the friend gives, Plex's
relay on their stream away from home (their last within `RECENT_AWAY`),
and the servers' free upload at the last speed test, plus the share of it
their own stream takes when one is playing. A version
(`luwin/plex_versions.py`) fits when its average bitrate, allowing
`PEAK_ALLOWANCE` for the busy scenes a file spikes through, stays under the
tightest limit (`best_fitting`). `recommend` picks the best version that
fits, or else the lightest, with the remote quality to set so Plex converts
it down (`quality_for`, Plex's own quality steps).

With nothing known, a connection away from home is taken to carry about
`REMOTE_COMFORT_KBPS` (`TYPICAL_AWAY`), and the reply says so. A stream
already lagging away from home is weighed against that typical connection
as well as what's known, since its own connection is what isn't.
"""

from __future__ import annotations

import time
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import timedelta

from luwin.clients import ClientError, Services
from luwin.formatting import mbps
from luwin.perf.uplink import Uplink
from luwin.playback.plays import RELAY_CAP_KBPS, REMOTE, Playback, playback_of, recent_plays
from luwin.plex_versions import TitleVersion

# A stream needs about this much more than a file's average bitrate to get
# through its busiest scenes without buffering.
PEAK_ALLOWANCE = 1.5
# Roughly what a connection away from home carries smoothly when nothing is
# measured: a stream sending more is likely what lags.
REMOTE_COMFORT_KBPS = 20_000
# A play away from home older than this says nothing about the friend's connection now.
RECENT_AWAY = timedelta(days=7)
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
    (720, "0.7 Mbps 328p"),
)


def quality_for(kbps: int) -> str:
    """The best Plex remote quality within a limit. Plex caps a converted stream at its
    quality's bitrate, so unlike a file played as it is, it needs no room for peaks."""
    return next((name for step, name in PLEX_QUALITIES if step <= kbps), PLEX_QUALITIES[-1][1])


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
        away: Playback | None = None,
        uplink: Uplink | None = None,
        streaming_kbps: int = 0,
    ) -> Connection:
        """From the speed the friend gives, a stream of theirs away from home, and the last
        speed test's free upload, plus `streaming_kbps`, the share of the upload their stream
        playing now already takes (the test ran alongside it)."""
        limits = []
        if said_mbps:
            limits.append(Limit(round(said_mbps * 1000), f"you said about {said_mbps:g} Mbps"))
        if away is not None and away.relayed:
            cap = f"{mbps(RELAY_CAP_KBPS):g}"
            limits.append(Limit(RELAY_CAP_KBPS, f"Plex relays your stream, at most {cap} Mbps"))
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


@dataclass(frozen=True)
class Pick:
    version: TitleVersion
    fits: bool  # False: nothing fits, so this is the lightest, turned down to `quality`
    limit: Limit

    @property
    def quality(self) -> str:
        """The remote quality to set: Original when it fits, else what the limit carries."""
        return "Original" if self.fits else quality_for(self.limit.kbps)


def best_fitting(versions: Iterable[TitleVersion], limit: Limit | None) -> TitleVersion | None:
    """The best version a limit carries as it is, peaks included; any with no limit (a home
    network carries any version); None when none fits."""
    fitting = [v for v in versions if limit is None or needs_kbps(v.bitrate_kbps) <= limit.kbps]
    return max(fitting, key=lambda v: v.bitrate_kbps, default=None)


def recommend(versions: Iterable[TitleVersion], limit: Limit) -> Pick | None:
    """The best version within the limit, else the lightest; None with no versions."""
    versions = list(versions)
    if not versions:
        return None
    if (fitting := best_fitting(versions, limit)) is not None:
        return Pick(fitting, True, limit)
    return Pick(min(versions, key=lambda v: v.bitrate_kbps), False, limit)


@dataclass(frozen=True)
class LastAway:
    """The friend's latest play away from home, and which hosts couldn't be asked."""

    playback: Playback | None
    unreachable: tuple[str, ...]


async def last_away(services: Services, tautulli_user_id: int | None) -> LastAway:
    """How the friend's latest play away from home went: live, or within `RECENT_AWAY`;
    nothing when their Plex account isn't matched to a Tautulli user."""
    if tautulli_user_id is None:
        return LastAway(None, ())
    found = await recent_plays(services, tautulli_user_id)
    missed = tuple(sorted(found.unreachable))
    since = time.time() - RECENT_AWAY.total_seconds()
    away = next(
        (p for p in found.plays if p.source.location in REMOTE and (p.live or p.started >= since)),
        None,
    )
    if away is None:
        return LastAway(None, missed)
    try:
        return LastAway(await playback_of(services, away), missed)
    except ClientError:
        return LastAway(None, (*missed, away.host))
