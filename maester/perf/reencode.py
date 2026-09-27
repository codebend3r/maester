"""Heavy remuxes friends keep streaming away from home: candidates for a re-encode.

When a friend's lagging stream plays a version at `HEAVY_KBPS` or more (a
remux, as a rule) whose Plex item holds no lighter version of the same
resolution (no re-encode beside it yet), that item's history is read in the
Tautulli that played it. Watched away from home `WAN_WATCHES_TO_FLAG` times
within `REENCODE_WINDOW`, it's worth re-encoding, and the admin is told with
the file and its bitrate, once per window per item (a claim, source
"reencode").

Tautulli groups a play resumed soon after into one history row, so these
are watches, not plays. Its history names the item, not the version, which
is why an item holding a lighter version of its resolution isn't a
candidate at all. A Tautulli that can't answer flags nothing; the next
report counts again. A sweep of the whole library waits for scheduled jobs.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from maester.clients import ClientError, Services
from maester.clients.tautulli import Tautulli
from maester.formatting import mbps
from maester.notify import AdminPost
from maester.perf.lag import Stream
from maester.playback.plays import REMOTE
from maester.plex_versions import TitleVersion
from maester.store import Store

# A version this heavy is a remux in all but name: 40 Mbps and up.
HEAVY_KBPS = 40_000
# Watches away from home within the window that make it worth re-encoding.
WAN_WATCHES_TO_FLAG = 3
REENCODE_WINDOW = timedelta(days=30)
# History rows asked for one item, newest first; more than a month of them is plenty.
HISTORY_DEPTH = 100
SOURCE = "reencode"


def candidate(version: TitleVersion, versions: tuple[TitleVersion, ...]) -> bool:
    """Heavy, with no lighter version of its resolution in its Plex item."""
    return version.bitrate_kbps >= HEAVY_KBPS and not any(
        other.rating_key == version.rating_key
        and other.version.resolution == version.version.resolution
        and other.bitrate_kbps < HEAVY_KBPS
        for other in versions
    )


async def wan_watches(tautulli: Tautulli, rating_key: str) -> int | None:
    """Watches of an item away from home within the window; None when Tautulli can't say."""
    since = datetime.now(UTC) - REENCODE_WINDOW
    try:
        rows = await tautulli.history(
            rating_key=rating_key, after=since.date(), length=HISTORY_DEPTH
        )
    except ClientError:
        return None
    return sum(1 for r in rows if r.location in REMOTE and r.started >= since.timestamp())


async def flag(services: Services, store: Store, stream: Stream) -> AdminPost | None:
    """Tell the admin, once a window, when the version a stream plays is worth re-encoding."""
    playing = stream.playing
    if playing is None or not candidate(playing, stream.versions):
        return None
    watches = await wan_watches(services.tautulli[stream.play.host], playing.rating_key)
    if watches is None or watches < WAN_WATCHES_TO_FLAG:
        return None
    if not store.claim(SOURCE, playing.rating_key, window=REENCODE_WINDOW):
        return None
    return AdminPost(
        f"{stream.play.title}'s {playing.name} version ({mbps(playing.bitrate_kbps):g} Mbps, "
        f"{playing.version.file}) was watched away from home {watches} times in the last "
        f"{REENCODE_WINDOW.days} days, with no lighter {playing.name} version beside it: a "
        "candidate for the HEVC re-encode."
    )
