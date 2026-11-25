"""What slows one stream down, and the one fix to give: findings as rules tables.

A friend saying "it's laggy" wants one thing to do, not a wall of stats. A
live stream (raven's `GET /api/streams/mine`, the asker's own) is read with
everything that bears on it (`Stream`): how raven sends it (as it is,
remuxed, or converted), the file's picture and bitrate, the title's other
files, the servers' upload at the last speed test while that's recent, and
away from home what the connection is known or taken to carry (`limit`).
Each rule finds its cause in a stream or doesn't, says the cause and the
fix in words (`Said`), and names the kind of fix (`Fix`): play another
version, watch in another player, or pick a smaller size in the player's
Quality menu.

A stream at home and one away from home fail in different ways, so each has
its table (`AT_HOME`, `AWAY`), picked once. A table's order is precedence:
the stream's reason to be converted first, then what the connection
carries. The first rule that finds something is the advice; every one that
does is in the details.

raven converts a file when the player can't play it as it is (its codec,
HDR or Dolby Vision) or when the viewer picked a size; it says which mode,
not why, so a conversion with no size picked is read as the player's.
"""

from __future__ import annotations

import asyncio
import enum
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sparrow.clients import ClientError
from sparrow.clients.raven import LiveStream, PlaybackMode, Raven, RavenFile, RavenItem
from sparrow.formatting import mbps
from sparrow.perf.uplink import Uplink
from sparrow.perf.versions import (
    Connection,
    Limit,
    best_fitting,
    needs_kbps,
    probed,
    quality_for,
    quality_label,
)

# Codecs every player raven serves plays as they are.
PLAIN_CODECS = frozenset({"h264"})


class Fix(enum.StrEnum):
    """The kinds of fix a finding calls for."""

    OTHER_VERSION = "other_version"
    OTHER_PLAYER = "other_player"
    LOWER_QUALITY = "lower_quality"


MODES = {
    PlaybackMode.DIRECT: "playing as it is",
    PlaybackMode.REMUX: "repackaged (remuxed), not converted",
    PlaybackMode.TRANSCODE: "converted on the fly (transcoded)",
}


def _mb(kbps: int) -> str:
    return f"{mbps(kbps):g} Mbps"


def plain(file: RavenFile) -> bool:
    """A file any player plays as it is: H.264 with no HDR or Dolby Vision."""
    return file.video_codec in PLAIN_CODECS and not (file.hdr or file.dolby_vision)


@dataclass(frozen=True)
class Stream:
    """One live stream and everything that bears on how it plays."""

    live: LiveStream
    uplink: Uplink | None  # the last speed test, while it's recent
    versions: tuple[RavenFile, ...]  # every probed file of its title, its own included
    # Away from home, what its connection is known or taken to carry, its own share of the
    # upload included; None at home, where the network carries any file.
    limit: Limit | None
    lighter: RavenFile | None  # a lighter file the connection carries as it is
    easier: RavenFile | None  # a plain file it carries, which plays without converting

    @classmethod
    def of(cls, live: LiveStream, uplink: Uplink | None, versions: tuple[RavenFile, ...]) -> Stream:
        limit = None
        if live.remote:
            known = Connection.of(uplink=uplink, streaming_kbps=live.send_kbps or 0)
            limit = known.limit(lagging_away=True)
        own = live.file
        others = [v for v in versions if v.id != own.id]
        lighter = best_fitting(
            (v for v in others if (v.bitrate_kbps or 0) < (own.bitrate_kbps or 0)), limit
        )
        easier = best_fitting((v for v in others if plain(v)), limit)
        return cls(live, uplink, versions, limit, lighter, easier)

    @property
    def file(self) -> RavenFile:
        return self.live.file

    @property
    def converted(self) -> bool:
        return self.live.mode == PlaybackMode.TRANSCODE

    @property
    def size_picked(self) -> str | None:
        """The size the viewer picked to convert to, as the player labels it."""
        return quality_label(self.live.quality)

    def carries(self, kbps: int) -> bool:
        return self.limit is None or kbps <= self.limit.kbps

    @property
    def over_limit(self) -> Limit | None:
        """The limit it's sent over as it is, peaks included; None when it fits, is converted
        (raven holds a conversion to its size's bitrate), or its bitrate isn't known."""
        bitrate = self.file.bitrate_kbps
        if self.converted or not bitrate or self.carries(needs_kbps(bitrate)):
            return None
        return self.limit

    def summary(self) -> str:
        """What the stream is doing, in a line: how, where, what, on what."""
        live = self.live
        where = "over the internet" if live.remote else "on the home network"
        size = f" to {self.size_picked}" if self.size_picked else ""
        rate = f" at {_mb(live.send_kbps)}" if live.send_kbps else ""
        return f"{MODES[live.mode]}{size} {where}{rate}, the {self.file.name} file, {live.player}"

    def as_dict(self) -> dict[str, Any]:
        live, file = self.live, self.file
        facts: dict[str, Any] = {
            "mode": live.mode,
            "size_picked": self.size_picked,
            "away_from_home": live.remote,
            "sending_mbps": mbps(live.send_kbps) if live.send_kbps else None,
            "file": {
                "version": file.name,
                "bitrate_mbps": mbps(file.bitrate_kbps) if file.bitrate_kbps else None,
            },
            "player": live.player,
            "uplink": self.uplink.as_dict() if self.uplink else "not tested in the last 10 minutes",
            "versions": [
                {"version": v.name, "bitrate_mbps": mbps(v.bitrate_kbps or 0)}
                for v in self.versions
            ],
        }
        if self.limit is not None:
            facts["connection"] = f"about {_mb(self.limit.kbps)}: {self.limit.source}"
        return facts


@dataclass(frozen=True)
class Said:
    cause: str
    advice: str


@dataclass(frozen=True)
class Finding:
    name: str
    fix: Fix
    said: Said

    def as_dict(self) -> dict[str, str]:
        return {"fix": self.fix, "cause": self.said.cause, "what_to_do": self.said.advice}


@dataclass(frozen=True)
class LagCause:
    """One thing that slows a stream: `find` says what it causes and the fix, or None."""

    name: str
    fix: Fix
    find: Callable[[Stream], Said | None]


def _players_conversion(s: Stream) -> bool:
    """raven converts it with no size picked, and the file isn't one every player plays."""
    return s.converted and s.size_picked is None and not plain(s.file)


def _picture_cause(s: Stream) -> str:
    return (
        f"{s.live.player} can't play this {s.file.name} file as it is, so raven converts it "
        "on the fly, which can fall behind."
    )


def _convert_easier(s: Stream) -> Said | None:
    if not (_players_conversion(s) and s.easier):
        return None
    return Said(
        _picture_cause(s),
        f"Play the {s.easier.name} version instead: it plays anywhere without being converted.",
    )


def _convert_player(s: Stream) -> Said | None:
    if not _players_conversion(s) or s.easier:
        return None
    return Said(
        _picture_cause(s),
        "Watch it in Raven, the Mac app: it plays every file as it is, without converting.",
    )


def _heavy_lighter(s: Stream) -> Said | None:
    limit, bitrate = s.over_limit, s.file.bitrate_kbps or 0
    if not (limit and s.lighter):
        return None
    return Said(
        f"You're playing the {s.file.name} file at {_mb(bitrate)}; its busiest scenes need "
        f"about {_mb(needs_kbps(bitrate))}, more than {limit.source} (about {_mb(limit.kbps)}).",
        f"Play the {s.lighter.name} version instead ({_mb(s.lighter.bitrate_kbps or 0)}).",
    )


def _heavy(s: Stream) -> Said | None:
    limit, bitrate = s.over_limit, s.file.bitrate_kbps or 0
    if limit is None:
        return None
    return Said(
        f"This file plays at {_mb(bitrate)}, and its busiest scenes need about "
        f"{_mb(needs_kbps(bitrate))}, more than {limit.source} (about {_mb(limit.kbps)}).",
        f"In the player's Playback menu, under Quality, pick Convert to {quality_for(limit.kbps)}.",
    )


def _uplink_full(s: Stream) -> Said | None:
    uplink, sent = s.uplink, s.live.send_kbps or s.file.bitrate_kbps or 0
    budget = uplink.spare_kbps + sent if uplink else 0
    if uplink is None or needs_kbps(sent) <= budget:
        return None
    return Said(
        f"The servers' upload is nearly full: the last speed test found only "
        f"{_mb(uplink.spare_kbps)} free alongside the streams already going out, too little "
        "for this stream's busy scenes.",
        f"In the player's Playback menu, under Quality, pick Convert to {quality_for(budget)} until other "
        "streams finish.",
    )


CONVERT_EASIER = LagCause("converted_other_version", Fix.OTHER_VERSION, _convert_easier)
CONVERT_PLAYER = LagCause("converted_other_player", Fix.OTHER_PLAYER, _convert_player)

AT_HOME: tuple[LagCause, ...] = (CONVERT_EASIER, CONVERT_PLAYER)
AWAY: tuple[LagCause, ...] = (
    CONVERT_EASIER,
    LagCause("heavy_with_lighter", Fix.OTHER_VERSION, _heavy_lighter),
    LagCause("heavy_stream", Fix.LOWER_QUALITY, _heavy),
    LagCause("uplink_full", Fix.LOWER_QUALITY, _uplink_full),
    CONVERT_PLAYER,
)

NOTHING_FOUND = {
    "fix": None,
    "cause": "Nothing on the server's side explains it.",
    "what_to_do": "The slowdown is likely the network between them and the server, or the "
    "device: reloading the page or restarting the app (or the router) often helps.",
}


@dataclass(frozen=True)
class Diagnosis:
    stream: Stream
    findings: tuple[Finding, ...]  # every rule of its table that found something, in order

    def brief(self) -> dict[str, Any]:
        """The one fix, and what the stream is doing in a line."""
        stream = self.stream
        brief: dict[str, Any] = {
            "title": stream.file.title,
            "library": stream.live.library,
            "stream": stream.summary(),
            "advice": self.findings[0].as_dict() if self.findings else NOTHING_FOUND,
        }
        if len(self.findings) > 1:
            brief["other_findings"] = len(self.findings) - 1
        return brief

    def details(self) -> dict[str, Any]:
        """The brief, with every finding and the stats behind them."""
        return {
            **self.brief(),
            "findings": [f.as_dict() for f in self.findings],
            **self.stream.as_dict(),
        }


def diagnose(stream: Stream) -> Diagnosis:
    table = AWAY if stream.live.remote else AT_HOME
    return Diagnosis(
        stream,
        tuple(
            Finding(rule.name, rule.fix, said)
            for rule in table
            if (said := rule.find(stream)) is not None
        ),
    )


async def _versions(raven: Raven, item_id: int | None) -> tuple[RavenFile, ...]:
    """Every probed file of the title a stream plays; none when raven can't say."""
    if item_id is None:
        return ()
    try:
        item: RavenItem = await raven.item(item_id)
    except ClientError:  # raven can't open the title: no versions to offer
        return ()
    return tuple(probed(item.files))


async def live_streams(raven: Raven, uplink: Uplink | None) -> list[Stream]:
    """The viewer's own live streams, each with its title's files."""
    mine = await raven.my_streams()
    versions = await asyncio.gather(*(_versions(raven, s.item_id) for s in mine))
    return [Stream.of(live, uplink, found) for live, found in zip(mine, versions, strict=True)]
