"""Heavy remuxes friends keep streaming away from home: candidates for a re-encode.

A version at `HEAVY_KBPS` or more (a remux, as a rule) whose Plex item holds
no lighter version of the same resolution (no re-encode beside it yet)
costs the upload every time someone streams it away from home. When
Tautulli's history shows that item played over the internet
`WAN_PLAYS_TO_FLAG` times within `REENCODE_WINDOW`, counted across every
host, the admin is told, with the file and its bitrate, once per window per
item (`reencode_flags`). Tautulli's history names the item played, not the
version, so an item that holds a lighter version of its resolution isn't a
candidate at all. A host whose history can't be read counts no plays; the
flag can wait for the next time someone asks.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from maester.clients import Services
from maester.clients.tautulli import HistoryRow
from maester.formatting import megabits
from maester.notify import AdminPost
from maester.perf.versions import TitleVersion
from maester.playback.plays import REMOTE
from maester.store import Store

# A version this heavy is a remux in all but name: 40 Mbps and up.
HEAVY_KBPS = 40_000
# Plays away from home within the window that make it worth re-encoding.
WAN_PLAYS_TO_FLAG = 3
REENCODE_WINDOW = timedelta(days=30)
# Finished plays asked of each host for one item, newest first.
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


async def wan_plays(services: Services, rating_key: str, since: datetime) -> int:
    """Plays of a Plex item away from home since `since`, counted once across hosts."""
    found = await asyncio.gather(
        *(
            t.history(rating_key=rating_key, length=HISTORY_DEPTH)
            for t in services.tautulli.values()
        ),
        return_exceptions=True,
    )
    rows: list[HistoryRow] = [row for rows in found if isinstance(rows, list) for row in rows]
    after = since.timestamp()
    # One person can't start two plays of one item in the same second.
    return len(
        {(r.user_id, r.started) for r in rows if r.location in REMOTE and r.started >= after}
    )


@dataclass(frozen=True)
class Candidate:
    title: str
    heavy: TitleVersion
    plays: int

    def notice(self) -> AdminPost:
        heavy = self.heavy
        return AdminPost(
            f"{self.title}'s {heavy.name} version ({megabits(heavy.bitrate_kbps)} Mbps, "
            f"{heavy.version.file}) was streamed away from home {self.plays} times in the last "
            f"{REENCODE_WINDOW.days} days, with no lighter {heavy.name} version beside it: "
            "a candidate for the HEVC re-encode."
        )


async def flag(
    services: Services, store: Store, title: str, versions: list[TitleVersion]
) -> tuple[AdminPost, ...]:
    """Tell the admin about the title's heavy versions friends keep streaming away from home,
    each once per window."""
    heavy = heavy_alone(versions)
    since = datetime.now(UTC) - REENCODE_WINDOW
    plays = await asyncio.gather(*(wan_plays(services, v.rating_key, since) for v in heavy))
    candidates = [
        Candidate(title, version, count)
        for version, count in zip(heavy, plays, strict=True)
        if count >= WAN_PLAYS_TO_FLAG
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
