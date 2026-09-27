"""What slows one stream down, and the one fix to give: findings as a rules table.

A friend saying "it's laggy" wants one thing to do, not a wall of stats. A
live stream is read with everything that bears on it (`Stream`): how it
plays (`Playback`), how busy its host is (`HostLoad`), the servers' upload
at the last speed test while that's recent, and the title's versions. Each
rule in `LAG_CAUSES` pairs a match with the cause and the fix to tell the
friend, and names the kind of fix (`Fix`): turn subtitles off, get around
Plex's relay, set remote quality to Original or lower it, play another
version, or wait for the server.

The table's order is precedence. Fixes that remove the stream's own reason
to be converted come first, then what the connection carries, and waiting
for the server comes last. A rule that `explains` what another sees hides
it (`unexplained`, as in the player check): subtitles burned in force a
conversion a busy server then lags on, and the relay squeezes a stream
whatever its bitrate. The first rule left is the advice; the rest are
details, given when asked.

Two of the player limits (`CLIENT_LIMITS`) slow a stream as well as stop
one, so the table reuses them as they are: picture subtitles burned in, and
HEVC the player can't decode. The codec rule never blames a stream squeezed
to fit a connection (a lower quality asked for, or the relay), so a
bandwidth-limited HEVC stream is read as bandwidth here, never as codecs.
"""

from __future__ import annotations

import asyncio
import enum
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from maester.clients import ClientError, Services
from maester.clients.tautulli import Session
from maester.formatting import megabits
from maester.perf.load import REAL_TIME, HostLoad
from maester.perf.uplink import Uplink
from maester.perf.versions import (
    REMOTE_COMFORT_KBPS,
    TYPICAL_AWAY,
    Connection,
    TitleVersion,
    quality_for,
    recommend,
    title_versions,
)
from maester.playback.client_limits import (
    HEVC_UNSUPPORTED,
    IMAGE_SUBTITLE_BURN_IN,
    ClientLimit,
    unexplained,
)
from maester.playback.plays import RELAY_CAP_KBPS, Play, Playback, identify


class Fix(enum.StrEnum):
    """The kinds of fix a finding calls for."""

    SUBTITLES_OFF = "subtitles_off"
    AVOID_RELAY = "avoid_relay"
    ORIGINAL_QUALITY = "original_quality"
    LOWER_QUALITY = "lower_quality"
    OTHER_VERSION = "other_version"
    WAIT = "wait"


DECISIONS = {
    "direct play": "direct play",
    "copy": "direct stream (repackaged, not converted)",
    "transcode": "transcoding (converted on the fly)",
}


@dataclass(frozen=True)
class Stream:
    """One live stream and everything that bears on how it plays."""

    title: str
    host: str  # the server sending it
    file: str  # the file it plays, as Plex knows it
    playback: Playback
    load: HostLoad  # its host's
    uplink: Uplink | None  # the last speed test, while it's recent
    versions: tuple[TitleVersion, ...]  # the title's, when Plex has any

    @property
    def playing(self) -> TitleVersion | None:
        return next((v for v in self.versions if v.version.file == self.file), None)

    @property
    def lighter(self) -> TitleVersion | None:
        """The best lighter version a connection away from home carries, if any."""
        playing = self.playing.bitrate_kbps if self.playing else self.playback.source_bitrate_kbps
        away = Connection((TYPICAL_AWAY, *Connection.of(uplink=self.uplink).limits))
        pick = recommend((v for v in self.versions if v.bitrate_kbps < playing), away)
        return pick.version if pick is not None and pick.fits else None

    @property
    def struggling(self) -> bool:
        """Its conversion runs slower than playback."""
        speed = self.playback.transcode_speed
        return speed is not None and speed < REAL_TIME

    @property
    def heavy(self) -> bool:
        """Sent away from home at more than most connections carry."""
        p = self.playback
        return p.remote and not p.squeezed and p.bitrate_kbps > REMOTE_COMFORT_KBPS

    def words(self) -> dict[str, Any]:
        """What the rules' texts are filled in with."""
        p, uplink, lighter = self.playback, self.uplink, self.lighter
        return {
            "host": self.host,
            "quality": p.quality_profile,
            "bitrate": megabits(p.bitrate_kbps),
            "source": megabits(p.source_bitrate_kbps),
            "playing": f"the {self.playing.name} version" if self.playing else "this version",
            "lighter": lighter.name if lighter else "",
            "lighter_mbps": megabits(lighter.bitrate_kbps) if lighter else "",
            "relay_cap": megabits(RELAY_CAP_KBPS),
            "relay_quality": quality_for(RELAY_CAP_KBPS),
            "comfort_quality": quality_for(REMOTE_COMFORT_KBPS),
            "spare": megabits(uplink.spare_kbps) if uplink else "",
            "streaming": megabits(uplink.streaming_kbps) if uplink else "",
            "spare_quality": quality_for(uplink.spare_kbps) if uplink else "",
            "strain": "; ".join(self.load.strain),
        }

    def summary(self) -> str:
        """What the stream is doing, in a line: how, where, how fast, on what, from where."""
        p = self.playback
        how = DECISIONS.get(p.transcode_decision, p.transcode_decision or "playing")
        where = "over the internet" if p.remote else "on the home network"
        relay = (
            f", relayed through Plex, which carries at most {megabits(RELAY_CAP_KBPS)} Mbps"
            if p.relayed
            else ""
        )
        version = f" ({self.playing.name})" if self.playing else ""
        return (
            f"{how} {where} at {megabits(p.bitrate_kbps)} Mbps{relay}{version}, "
            f"{p.product} on {p.player}, from {self.host}"
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "playback": self.playback.as_dict(),
            "host_load": {"host": self.host, **self.load.as_dict()},
            "uplink": self.uplink.as_dict() if self.uplink else "not tested in the last 10 minutes",
            "versions": [v.as_dict() for v in self.versions],
        }


@dataclass(frozen=True)
class Finding:
    name: str
    fix: Fix
    cause: str
    advice: str

    def as_dict(self) -> dict[str, str]:
        return {"fix": self.fix, "cause": self.cause, "what_to_do": self.advice}


@dataclass(frozen=True)
class LagCause:
    """One thing that slows a stream: when it applies, what it causes, and the fix.

    `cause` and `advice` are filled in from `Stream.words()`.
    """

    name: str
    applies: Callable[[Stream], bool]
    fix: Fix
    cause: str
    advice: str
    explains: frozenset[str] = frozenset()

    def found(self, stream: Stream) -> Finding:
        words = stream.words()
        return Finding(
            self.name, self.fix, self.cause.format_map(words), self.advice.format_map(words)
        )


def lifted(limit: ClientLimit, fix: Fix, *, explains: frozenset[str]) -> LagCause:
    """A player limit that slows a stream too, read off the stream's playback."""
    return LagCause(
        limit.name,
        lambda s: limit.applies(s.playback),
        fix,
        limit.cause,
        limit.fix,
        limit.explains | explains,
    )


def _converted_away(s: Stream) -> bool:
    """Converted down to a lower quality asked for away from home, and falling behind."""
    p = s.playback
    return p.remote and p.lowered and p.video_decision == "transcode" and s.struggling


SERVER_BUSY = "server_busy"

LAG_CAUSES: tuple[LagCause, ...] = (
    lifted(IMAGE_SUBTITLE_BURN_IN, Fix.SUBTITLES_OFF, explains=frozenset({SERVER_BUSY})),
    LagCause(
        "relayed",
        lambda s: s.playback.relayed,
        Fix.AVOID_RELAY,
        "Plex can't reach {host} directly from where you are, so it sends the stream through "
        "its relay, which carries at most {relay_cap} Mbps.",
        "For now, set remote quality to {relay_quality} in the Plex app so it fits. For good, "
        "the admin needs {host} reachable directly (Remote Access), and can then turn relay "
        "off (Enable Relay, in the server's Network settings).",
        # The relay squeezes the stream to fit it, whatever it asked for or the upload has.
        explains=frozenset({"converting_heavy_file", "quality_too_slow", "uplink_full"}),
    ),
    lifted(HEVC_UNSUPPORTED, Fix.OTHER_VERSION, explains=frozenset({SERVER_BUSY})),
    LagCause(
        "converting_heavy_file",
        lambda s: (
            _converted_away(s)
            and s.playback.source_bitrate_kbps > REMOTE_COMFORT_KBPS
            and s.lighter is not None
        ),
        Fix.OTHER_VERSION,
        "Your Plex app asks for {quality} away from home, so {host} converts the {source} Mbps "
        "file down for you, and it can't keep up.",
        "Play the {lighter} version instead ({lighter_mbps} Mbps): far less to convert, or "
        "nothing at all.",
        explains=frozenset({SERVER_BUSY}),
    ),
    LagCause(
        "quality_too_slow",
        lambda s: _converted_away(s) and s.playback.source_bitrate_kbps <= REMOTE_COMFORT_KBPS,
        Fix.ORIGINAL_QUALITY,
        "Your Plex app asks for {quality} away from home, so {host} converts the video for "
        "you, and it can't keep up.",
        "Set remote quality to Original (Maximum) in the Plex app: this file is {source} Mbps, "
        "light enough to play as it is.",
        explains=frozenset({SERVER_BUSY}),
    ),
    LagCause(
        "heavy_with_lighter",
        lambda s: s.heavy and s.lighter is not None,
        Fix.OTHER_VERSION,
        "You're playing {playing} at {bitrate} Mbps, more than most connections away from "
        "home carry smoothly.",
        "Play the {lighter} version instead ({lighter_mbps} Mbps).",
        explains=frozenset({"heavy_stream", "uplink_full"}),
    ),
    LagCause(
        "heavy_stream",
        lambda s: s.heavy,
        Fix.LOWER_QUALITY,
        "This stream sends {bitrate} Mbps, more than most connections away from home carry "
        "smoothly.",
        "Set remote quality to {comfort_quality} in the Plex app.",
        explains=frozenset({"uplink_full"}),
    ),
    LagCause(
        "uplink_full",
        lambda s: s.playback.remote and s.uplink is not None and s.uplink.tight,
        Fix.LOWER_QUALITY,
        "The servers' upload is nearly full: the last speed test found only {spare} Mbps free "
        "alongside {streaming} Mbps of remote streams.",
        "Set remote quality to {spare_quality} in the Plex app until other streams finish.",
    ),
    LagCause(
        SERVER_BUSY,
        lambda s: s.load.busy,
        Fix.WAIT,
        "{host} is busy: {strain}.",
        "Wait a few minutes for other streams to finish, then try again.",
    ),
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
    findings: tuple[Finding, ...]  # every cause left after `explains`, advice first

    def brief(self) -> dict[str, Any]:
        """The one fix, and what the stream is doing in a line."""
        advice = self.findings[0].as_dict() if self.findings else NOTHING_FOUND
        stream = self.stream
        brief = {
            "title": stream.title,
            "host": stream.host,
            "stream": stream.summary(),
            "advice": advice,
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
    matched = unexplained(rule for rule in LAG_CAUSES if rule.applies(stream))
    return Diagnosis(stream, tuple(rule.found(stream) for rule in matched))


async def _versions(services: Services, play: Play) -> tuple[TitleVersion, ...]:
    """The title's versions on Plex; none when it can't be told what the play is."""
    try:
        return tuple(await title_versions(services.plex, await identify(services, play)))
    except (LookupError, ClientError):
        return ()


async def stream_of(
    services: Services, host: str, session: Session, load: HostLoad, uplink: Uplink | None
) -> Stream:
    play = Play.from_session(host, session)
    versions = await _versions(services, play)
    return Stream(
        play.title, host, session.file, Playback.from_session(session), load, uplink, versions
    )


async def live_streams(
    services: Services, loads: dict[str, HostLoad], tautulli_user_id: int, uplink: Uplink | None
) -> list[Stream]:
    """One friend's live streams on every host, read from the loads already fetched."""
    return list(
        await asyncio.gather(
            *(
                stream_of(services, host, s, load, uplink)
                for host, load in sorted(loads.items())
                for s in load.activity.sessions
                if s.user_id == tautulli_user_id
            )
        )
    )
