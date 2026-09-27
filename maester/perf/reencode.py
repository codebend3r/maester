"""Heavy remuxes friends keep streaming away from home: candidates for a re-encode.

A version at `HEAVY_KBPS` or more (a remux, as a rule) whose Plex item holds
no lighter version of the same resolution (no re-encode beside it yet)
costs the upload every time someone streams it away from home. When that
item was played over the internet `WAN_PLAYS_TO_FLAG` times within
`REENCODE_WINDOW`, the admin is told, with the file and its bitrate, once
per window per item (`reencode_flags`).

A rating key names an item on the Plex server maester reads, so its plays
are counted only in a Tautulli watching that server (`library_hosts`).
Tautulli's history names the item played, not the version, which is why an
item holding a lighter version of its resolution isn't a candidate at all.
When that Tautulli can't answer, nothing is flagged; the next ask counts again.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from maester.clients import ClientError, Services
from maester.formatting import mbps
from maester.notify import AdminPost
from maester.playback.plays import REMOTE, library_hosts
from maester.plex_versions import TitleVersion
from maester.store import Store

# A version this heavy is a remux in all but name: 40 Mbps and up.
HEAVY_KBPS = 40_000
# Plays away from home within the window that make it worth re-encoding.
WAN_PLAYS_TO_FLAG = 3
REENCODE_WINDOW = timedelta(days=30)
# Finished plays asked for one item, newest first; more than a month of them is plenty.
HISTORY_DEPTH = 100


def heavy_alone(versions: list[TitleVersion]) -> list[TitleVersion]:
    """Heavy versions whose Plex item holds no lighter version of their resolution."""
    return [
        v
        for v in versions
        if v.bitrate_kbps >= HEAVY_KBPS
        and not any(
            other.rating_key == v.rating_key
            and other.version.resolution == v.version.resolution
            and other.bitrate_kbps < HEAVY_KBPS
            for other in versions
        )
    ]


async def wan_plays(services: Services, host: str, rating_key: str) -> int | None:
    """Plays of an item away from home within the window, in its server's Tautulli; None
    when that Tautulli can't answer."""
    since = datetime.now(UTC) - REENCODE_WINDOW
    try:
        rows = await services.tautulli[host].history(
            rating_key=rating_key, after=since.date(), length=HISTORY_DEPTH
        )
    except ClientError:
        return None
    return sum(1 for r in rows if r.location in REMOTE and r.started >= since.timestamp())


@dataclass(frozen=True)
class Candidate:
    title: str
    heavy: TitleVersion
    plays: int

    def notice(self) -> AdminPost:
        heavy = self.heavy
        return AdminPost(
            f"{self.title}'s {heavy.name} version ({mbps(heavy.bitrate_kbps):g} Mbps, "
            f"{heavy.version.file}) was streamed away from home {self.plays} times in the last "
            f"{REENCODE_WINDOW.days} days, with no lighter {heavy.name} version beside it: "
            "a candidate for the HEVC re-encode."
        )


async def flag(
    services: Services, store: Store, title: str, versions: list[TitleVersion]
) -> tuple[AdminPost, ...]:
    """Tell the admin about the title's heavy versions friends keep streaming away from home,
    each once per window."""
    library, heavy = await library_hosts(services), heavy_alone(versions)
    host = min(library, default=None)
    if host is None or not heavy:
        return ()
    plays = await asyncio.gather(*(wan_plays(services, host, v.rating_key) for v in heavy))
    candidates = [
        Candidate(title, version, count)
        for version, count in zip(heavy, plays, strict=True)
        if count is not None and count >= WAN_PLAYS_TO_FLAG
    ]
    return tuple(
        c.notice()
        for c in candidates
        if store.flag_reencode(
            rating_key=c.heavy.rating_key,
            title=title,
            file=c.heavy.version.file,
            bitrate_kbps=c.heavy.bitrate_kbps,
            wan_plays=c.plays,
            window=REENCODE_WINDOW,
        )
    )
