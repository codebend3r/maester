"""What slows one stream down, and the one fix to give: findings as rules tables.

A friend saying "it's laggy" wants one thing to do, not a wall of stats. A
live stream is read with everything that bears on it (`Stream`): how it
plays (`Playback`), how busy its host is with its other streams
(`HostLoad.without`), the servers' upload at the last speed test while
that's recent, the title's other versions, and away from home what the
connection is known or taken to carry (`limit`). Each rule finds its cause
in a stream or doesn't, says the cause and the fix in words (`Said`), and
names the kind of fix (`Fix`): turn subtitles off, get around Plex's
relay, set remote quality to Original or lower it, play another version,
watch on another player, or wait for the server.

A stream at home and one away from home fail in different ways, so each has
its table (`AT_HOME`, `AWAY`), picked once. A table's order is precedence:
fixes that remove the stream's reason to be converted first, then what the
connection carries, and waiting for a busy server last. The first rule that
finds something is the advice; every one that does is in the details.

Tautulli says whether a stream is converted and how fast, not why. At home
the HEVC rule reads a conversion as the player's (its codec, HDR or 4K).
Away from home a video converted down may be the app's remote quality or
the player, so the fix given is the one right either way: an H.264 version
that plays without converting. Only an H.264 file, which every player
decodes, converted down away from home is put down to the remote quality.

Two player limits (`CLIENT_LIMITS`) slow a stream as well as stop one:
picture subtitles burned in, and HEVC the player can't play as it is. Their
causes are reused; their fixes are said here, naming only versions there are.

Versions are named only for a stream served by the Plex server maester
reads (`library_hosts`), whose file is one of them: a rating key means an
item on that server alone.
"""

from __future__ import annotations

import asyncio
import enum
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from maester.clients import ClientError, Services
from maester.clients.tautulli import Session
from maester.formatting import mbps
from maester.perf.load import HostLoad, behind
from maester.perf.uplink import Uplink
from maester.perf.versions import Connection, Limit, best_fitting, needs_kbps, quality_for
from maester.playback.client_limits import (
    HEVC_UNSUPPORTED,
    IMAGE_SUBTITLE_BURN_IN,
    client_causes,
)
from maester.playback.plays import RELAY_CAP_KBPS, Play, Playback, identify
from maester.plex_versions import TitleVersion, title_versions


class Fix(enum.StrEnum):
    """The kinds of fix a finding calls for."""

    SUBTITLES_OFF = "subtitles_off"
    AVOID_RELAY = "avoid_relay"
    ORIGINAL_QUALITY = "original_quality"
    LOWER_QUALITY = "lower_quality"
    OTHER_VERSION = "other_version"
    OTHER_PLAYER = "other_player"
    WAIT = "wait"


DECISIONS = {
    "direct play": "direct play",
    "copy": "direct stream (repackaged, not converted)",
    "transcode": "transcoding (converted on the fly)",
}


def _mb(kbps: int) -> str:
    return f"{mbps(kbps):g} Mbps"


@dataclass(frozen=True)
class Stream:
    """One live stream and everything that bears on how it plays."""

    play: Play  # its title and the host sending it
    playback: Playback
    load: HostLoad  # its host's other streams
    uplink: Uplink | None  # the last speed test, while it's recent
    versions: tuple[TitleVersion, ...]  # the title's, when its server is the one maester reads
    playing: TitleVersion | None  # which of them it plays
    # Away from home, what its connection is known or taken to carry, its own share of the
    # upload included; None at home, where the network carries any version.
    limit: Limit | None
    lighter: TitleVersion | None  # a lighter version the connection carries as it is
    easier: TitleVersion | None  # an H.264 version it carries, which plays without converting

    @classmethod
    def of(
        cls,
        host: str,
        session: Session,
        load: HostLoad,
        uplink: Uplink | None,
        versions: tuple[TitleVersion, ...],
    ) -> Stream:
        """A live session, with the version it plays and the ones worth switching to: only
        when its file is one of the versions, which proves they're on its server."""
        playback = Playback.from_session(session)
        limit = None
        if playback.remote:
            known = Connection.of(
                away=playback, uplink=uplink, streaming_kbps=playback.bitrate_kbps
            )
            limit = known.limit(lagging_away=True)
        playing = next((v for v in versions if v.version.file == session.file), None)
        lighter = easier = None
        if playing is not None:
            others = [v for v in versions if v is not playing]
            lighter = best_fitting(
                (v for v in others if v.bitrate_kbps < playing.bitrate_kbps), limit
            )
            easier = best_fitting((v for v in others if v.version.video_codec == "h264"), limit)
        play = Play.from_session(host, session)
        return cls(play, playback, load, uplink, versions, playing, limit, lighter, easier)

    @property
    def converted(self) -> bool:
        return self.playback.video_decision == "transcode"

    @property
    def cant_play_hevc(self) -> bool:
        """The player check's HEVC limit, less when burned-in subtitles force the conversion."""
        return HEVC_UNSUPPORTED in client_causes(self.playback)

    @property
    def easier_fixes_it(self) -> TitleVersion | None:
        """An H.264 version that would play without converting: none while picture subtitles
        are burned in, which another version burns in too."""
        return None if IMAGE_SUBTITLE_BURN_IN.applies(self.playback) else self.easier

    def carries(self, kbps: int) -> bool:
        return self.limit is None or kbps <= self.limit.kbps

    def lower_quality(self, within_kbps: int) -> str:
        """The best Plex quality within a limit that's below what it's sent at now: a quality
        at or above that bitrate would leave it as it is."""
        return quality_for(min(within_kbps, self.playback.bitrate_kbps - 1))

    @property
    def over_limit(self) -> Limit | None:
        """The limit it's sent over as it is, peaks included; None when it fits, or is
        converted (Plex holds a conversion to its quality's bitrate)."""
        if self.converted or self.carries(needs_kbps(self.playback.bitrate_kbps)):
            return None
        return self.limit

    def summary(self) -> str:
        """What the stream is doing, in a line: how, where, how fast, on what, from where."""
        p = self.playback
        how = DECISIONS.get(p.transcode_decision, p.transcode_decision or "playing")
        where = "over the internet" if p.remote else "on the home network"
        relay = (
            f", relayed through Plex, which carries at most {_mb(RELAY_CAP_KBPS)}"
            if p.relayed
            else ""
        )
        version = f" ({self.playing.name})" if self.playing else ""
        return (
            f"{how} {where} at {_mb(p.bitrate_kbps)}{relay}{version}, "
            f"{p.product} on {p.player}, from {self.play.host}"
        )

    def as_dict(self) -> dict[str, Any]:
        facts: dict[str, Any] = {
            "playback": self.playback.as_dict(),
            "host_load": {"host": self.play.host, "other_streams": self.load.as_dict()},
            "uplink": self.uplink.as_dict() if self.uplink else "not tested in the last 10 minutes",
            "versions": [v.as_dict() for v in self.versions],
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


def _burn_in(s: Stream) -> Said | None:
    limit = IMAGE_SUBTITLE_BURN_IN
    return Said(limit.cause, limit.fix) if limit.applies(s.playback) else None


def _hevc_easier(s: Stream) -> Said | None:
    easier = s.easier_fixes_it
    if not (s.cant_play_hevc and easier):
        return None
    return Said(
        HEVC_UNSUPPORTED.cause,
        f"Play the {easier.name} version instead ({_mb(easier.bitrate_kbps)}): it plays on "
        "anything without being converted.",
    )


def _hevc_player(s: Stream) -> Said | None:
    if not s.cant_play_hevc or s.easier_fixes_it:
        return None
    return Said(
        HEVC_UNSUPPORTED.cause,
        "Watch on a player that plays it as it is: the Plex app on a TV from 2017 on, an "
        "Apple TV 4K, a Shield or a recent Roku; web browsers usually can't.",
    )


def _relayed(s: Stream) -> Said | None:
    if not s.playback.relayed:
        return None
    host = s.play.host
    return Said(
        f"Plex can't reach {host} directly from where you are, so it sends the stream "
        f"through its relay, which carries at most {_mb(RELAY_CAP_KBPS)}.",
        f"For now, set remote quality to {quality_for(RELAY_CAP_KBPS)} in the Plex app so it "
        f"fits. For good, the admin needs {host} reachable directly (Remote Access), and can "
        "then turn relay off (Enable Relay, in the server's Network settings).",
    )


def _behind_easier(s: Stream) -> Said | None:
    easier = s.easier_fixes_it
    if not (behind(s.playback) and easier):
        return None
    return Said(
        f"{s.play.host} can't convert this stream as fast as it plays.",
        f"Play the {easier.name} version instead ({_mb(easier.bitrate_kbps)}): it plays on "
        "anything without being converted.",
    )


def _quality_below_file(s: Stream) -> Said | None:
    p = s.playback
    h264 = p.video_codec == "h264"
    if not (h264 and p.reduced and behind(p) and s.carries(needs_kbps(p.source_bitrate_kbps))):
        return None
    return Said(
        f"Your Plex app's remote quality is set below this {_mb(p.source_bitrate_kbps)} file, "
        f"so {s.play.host} converts it down for you, and it can't keep up.",
        "Set remote quality to Original (Maximum) in the Plex app: your connection carries "
        "the file as it is.",
    )


def _heavy_lighter(s: Stream) -> Said | None:
    limit = s.over_limit
    if not (limit and s.lighter and s.playing):
        return None
    sent = s.playback.bitrate_kbps
    return Said(
        f"You're playing the {s.playing.name} version at {_mb(sent)}; its busiest scenes need "
        f"about {_mb(needs_kbps(sent))}, more than {limit.source} (about {_mb(limit.kbps)}).",
        f"Play the {s.lighter.name} version instead ({_mb(s.lighter.bitrate_kbps)}).",
    )


def _heavy(s: Stream) -> Said | None:
    limit = s.over_limit
    if limit is None:
        return None
    sent = s.playback.bitrate_kbps
    return Said(
        f"This stream sends {_mb(sent)}, and its busiest scenes need about "
        f"{_mb(needs_kbps(sent))}, more than {limit.source} (about {_mb(limit.kbps)}).",
        f"Set remote quality to {s.lower_quality(limit.kbps)} in the Plex app.",
    )


def _uplink_full(s: Stream) -> Said | None:
    uplink, sent = s.uplink, s.playback.bitrate_kbps
    budget = uplink.spare_kbps + sent if uplink else 0
    if uplink is None or needs_kbps(sent) <= budget:
        return None
    return Said(
        f"The servers' upload is nearly full: the last speed test found only "
        f"{_mb(uplink.spare_kbps)} free alongside {_mb(uplink.streaming_kbps)} of remote "
        "streams, too little for this stream's busy scenes.",
        f"Set remote quality to {s.lower_quality(budget)} in the Plex app until other streams "
        "finish.",
    )


def _behind(s: Stream) -> Said | None:
    if not behind(s.playback):
        return None
    return Said(
        f"{s.play.host} can't convert this stream as fast as it plays.",
        f"Set a lower quality in the Plex app than the {_mb(s.playback.bitrate_kbps)} it gets "
        "now, so there's less to convert.",
    )


def _busy(s: Stream) -> Said | None:
    load, host = s.load, s.play.host
    others = bool(load.activity.sessions)
    # With nothing else playing, a converted stream's own conversion may be what fills the CPU.
    vitals = load.vitals_high if others or not s.converted else ()
    reasons = "; ".join((*load.conversions_behind, *vitals))
    if not reasons:
        return None
    if others:
        return Said(
            f"{host} is busy with other streams: {reasons}.",
            "Wait a few minutes for other streams to finish, then try again.",
        )
    return Said(
        f"{host} is busy with something besides Plex: {reasons}, and nothing else is playing.",
        "Wait a few minutes, then try again.",
    )


BURN_IN = LagCause("image_subtitle_burn_in", Fix.SUBTITLES_OFF, _burn_in)
BEHIND_EASIER = LagCause("behind_easier", Fix.OTHER_VERSION, _behind_easier)
BEHIND = LagCause("behind", Fix.LOWER_QUALITY, _behind)
BUSY = LagCause("server_busy", Fix.WAIT, _busy)

AT_HOME: tuple[LagCause, ...] = (
    BURN_IN,
    LagCause("hevc_other_version", Fix.OTHER_VERSION, _hevc_easier),
    LagCause("hevc_other_player", Fix.OTHER_PLAYER, _hevc_player),
    BEHIND_EASIER,
    BEHIND,
    BUSY,
)
AWAY: tuple[LagCause, ...] = (
    BURN_IN,
    LagCause("relayed", Fix.AVOID_RELAY, _relayed),
    BEHIND_EASIER,
    LagCause("quality_below_file", Fix.ORIGINAL_QUALITY, _quality_below_file),
    LagCause("heavy_with_lighter", Fix.OTHER_VERSION, _heavy_lighter),
    LagCause("heavy_stream", Fix.LOWER_QUALITY, _heavy),
    LagCause("uplink_full", Fix.LOWER_QUALITY, _uplink_full),
    BEHIND,
    BUSY,
)

NOTHING_FOUND = {
    "fix": None,
    "cause": "Nothing on the server's side explains it.",
    "what_to_do": "The slowdown is likely the network between them and the server, or the "
    "device: restarting the Plex app (or the router) often helps.",
}


@dataclass(frozen=True)
class Diagnosis:
    stream: Stream
    findings: tuple[Finding, ...]  # every rule of its table that found something, in order

    def brief(self) -> dict[str, Any]:
        """The one fix, and what the stream is doing in a line."""
        stream = self.stream
        brief: dict[str, Any] = {
            "title": stream.play.title,
            "host": stream.play.host,
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
    table = AWAY if stream.playback.remote else AT_HOME
    return Diagnosis(
        stream,
        tuple(
            Finding(rule.name, rule.fix, said)
            for rule in table
            if (said := rule.find(stream)) is not None
        ),
    )


async def _versions(
    services: Services, host: str, session: Session, library: frozenset[str]
) -> tuple[TitleVersion, ...]:
    """A movie's versions, when the play came from the Plex server maester reads."""
    play = Play.from_session(host, session)
    if host not in library or play.kind != "movie":
        return ()
    try:
        return tuple(await title_versions(services.plex, await identify(services, play)))
    except (LookupError, ClientError):  # Plex or Seerr can't say what it is: no versions
        return ()


async def live_streams(
    services: Services,
    loads: dict[str, HostLoad],
    tautulli_user_id: int,
    uplink: Uplink | None,
    library: frozenset[str],
) -> list[Stream]:
    """One friend's live streams on every host, read from the loads already fetched."""
    mine = [
        (host, s, load)
        for host, load in sorted(loads.items())
        for s in load.activity.sessions
        if s.user_id == tautulli_user_id
    ]
    versions = await asyncio.gather(
        *(_versions(services, host, session, library) for host, session, _ in mine)
    )
    return [
        Stream.of(host, session, load.without(session), uplink, found)
        for (host, session, load), found in zip(mine, versions, strict=True)
    ]
