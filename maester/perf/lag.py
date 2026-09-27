"""What slows one stream down, and the one fix to give: findings as a rules table.

A friend saying "it's laggy" wants one thing to do, not a wall of stats. A
live stream is read with everything that bears on it (`Stream`): how it
plays (`Playback`), how busy its host is with its other streams
(`HostLoad.without`), the servers' upload at the last speed test while
that's recent, and the title's other versions. Each rule in `LAG_CAUSES`
finds its cause in a stream or doesn't, says the cause and the fix in words
(`Said`), and names the kind of fix (`Fix`): turn subtitles off, get around
Plex's relay, set remote quality to Original or lower it, play another
version, or wait for the server.

Tautulli says whether a stream is converted and how fast, but not why, and
its quality label is only the bitrate sent. So the rules never claim what a
player asked for: away from home, a video converted down may be the app's
remote quality or a codec the player lacks, and the fix given is the one
that's right either way (an H.264 version plays on anything without
converting). Only an H.264 file, which every player decodes, converted down
away from home is put down to the remote quality setting. At home a player
gets the file's own quality, so there it's the codec.

The table's order is precedence. Fixes that remove the stream's reason to
be converted come first, then what the connection carries, and waiting for
a busy server last. A rule that `explains` what another sees hides it
(`unexplained`, as in the player check): burning subtitles in forces the
conversion that then falls behind, and the relay squeezes a stream whatever
the upload has. The first rule left is the advice; the rest are details.

Two player limits (`CLIENT_LIMITS`) slow a stream as well as stop one, so
the table reuses them as they are: picture subtitles burned in, and HEVC a
player at home can't decode.

Versions are named only for a stream served by the Plex server maester
reads (`library_host`), whose file is one of them: a rating key means an
item on that server alone.
"""

from __future__ import annotations

import asyncio
import enum
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from maester.clients import ClientError, Services
from maester.clients.tautulli import Session
from maester.formatting import mbps
from maester.perf.load import HostLoad, behind
from maester.perf.uplink import Uplink
from maester.perf.versions import (
    REMOTE_COMFORT_KBPS,
    Connection,
    Limit,
    needs_kbps,
    quality_for,
)
from maester.playback.client_limits import (
    HEVC_UNSUPPORTED,
    IMAGE_SUBTITLE_BURN_IN,
    ClientLimit,
    unexplained,
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
    WAIT = "wait"


DECISIONS = {
    "direct play": "direct play",
    "copy": "direct stream (repackaged, not converted)",
    "transcode": "transcoding (converted on the fly)",
}


def _mb(kbps: int) -> str:
    return f"{mbps(kbps):g} Mbps"


def _best(versions: Iterable[TitleVersion], limit: Limit | None) -> TitleVersion | None:
    """The best version a limit carries as it is; any, with no limit (at home)."""
    fitting = [v for v in versions if limit is None or needs_kbps(v) <= limit.kbps]
    return max(fitting, key=lambda v: v.bitrate_kbps, default=None)


@dataclass(frozen=True)
class Stream:
    """One live stream and everything that bears on how it plays."""

    play: Play  # its title and the host sending it
    playback: Playback
    load: HostLoad  # its host's other streams
    uplink: Uplink | None  # the last speed test, while it's recent
    versions: tuple[TitleVersion, ...]  # the title's, when its server is the one maester reads
    playing: TitleVersion | None  # which of them it plays
    lighter: TitleVersion | None  # a lighter one the connection carries as it is
    easier: TitleVersion | None  # an H.264 one the connection carries, so nothing converts

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
        playing = next((v for v in versions if v.version.file == session.file), None)
        # Away from home, a version must fit what the connection is known or taken to carry.
        limit = (
            Connection.of(away=playback, uplink=uplink).limit(lagging_away=True)
            if playback.remote
            else None
        )
        lighter = easier = None
        if playing is not None:
            others = [v for v in versions if v is not playing]
            lighter = _best((v for v in others if v.bitrate_kbps < playing.bitrate_kbps), limit)
            easier = _best((v for v in others if v.version.video_codec == "h264"), limit)
        play = Play.from_session(host, session)
        return cls(play, playback, load, uplink, versions, playing, lighter, easier)

    @property
    def converted(self) -> bool:
        return self.playback.video_decision == "transcode"

    @property
    def heavy(self) -> bool:
        """Sent as it is away from home, at more than most connections carry."""
        p = self.playback
        return p.remote and not self.converted and p.bitrate_kbps > REMOTE_COMFORT_KBPS

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
        return {
            "playback": self.playback.as_dict(),
            "host_load": {"host": self.play.host, "other_streams": self.load.as_dict()},
            "uplink": self.uplink.as_dict() if self.uplink else "not tested in the last 10 minutes",
            "versions": [v.as_dict() for v in self.versions],
        }


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
    explains: frozenset[str] = frozenset()


def lifted(limit: ClientLimit, fix: Fix, *, explains: Iterable[str]) -> LagCause:
    """A player limit that slows a stream too, read off the stream's playback."""
    said = Said(limit.cause, limit.fix)
    return LagCause(
        limit.name,
        fix,
        lambda s: said if limit.applies(s.playback) else None,
        limit.explains | frozenset(explains),
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
    if not (behind(s.playback) and s.easier):
        return None
    return Said(
        f"{s.play.host} can't convert this stream as fast as it plays.",
        f"Play the {s.easier.name} version instead ({_mb(s.easier.bitrate_kbps)}): it plays "
        "on anything without being converted.",
    )


def _quality_below_file(s: Stream) -> Said | None:
    p = s.playback
    light_h264 = p.video_codec == "h264" and p.source_bitrate_kbps <= REMOTE_COMFORT_KBPS
    if not (p.remote and p.reduced and behind(p) and light_h264):
        return None
    return Said(
        f"Your Plex app's remote quality is set below this {_mb(p.source_bitrate_kbps)} file, "
        f"so {s.play.host} converts it down for you, and it can't keep up.",
        "Set remote quality to Original (Maximum) in the Plex app: the file is light enough "
        "to play as it is.",
    )


def _heavy_with_lighter(s: Stream) -> Said | None:
    if not (s.heavy and s.lighter and s.playing):
        return None
    return Said(
        f"You're playing the {s.playing.name} version at {_mb(s.playback.bitrate_kbps)}, more "
        "than most connections away from home carry smoothly.",
        f"Play the {s.lighter.name} version instead ({_mb(s.lighter.bitrate_kbps)}).",
    )


def _heavy(s: Stream) -> Said | None:
    if not s.heavy:
        return None
    return Said(
        f"This stream sends {_mb(s.playback.bitrate_kbps)}, more than most connections away "
        "from home carry smoothly.",
        f"Set remote quality to {quality_for(REMOTE_COMFORT_KBPS)} in the Plex app.",
    )


def _uplink_full(s: Stream) -> Said | None:
    uplink = s.uplink
    if not (s.playback.remote and uplink and uplink.tight):
        return None
    return Said(
        f"The servers' upload is nearly full: the last speed test found only "
        f"{_mb(uplink.spare_kbps)} free alongside {_mb(uplink.streaming_kbps)} of remote "
        "streams.",
        f"Set remote quality to {quality_for(uplink.spare_kbps)} in the Plex app until other "
        "streams finish.",
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
    if not s.load.busy:
        return None
    return Said(
        f"{s.play.host} is busy with other streams: {'; '.join(s.load.strain)}.",
        "Wait a few minutes for other streams to finish, then try again.",
    )


CONVERSION = ("behind_easier", "quality_below_file", "behind")

LAG_CAUSES: tuple[LagCause, ...] = (
    # Burning picture subtitles in forces the conversion.
    lifted(IMAGE_SUBTITLE_BURN_IN, Fix.SUBTITLES_OFF, explains=CONVERSION),
    # The relay squeezes the stream to 2 Mbps whatever the version or the upload.
    LagCause(
        "relayed",
        Fix.AVOID_RELAY,
        _relayed,
        frozenset({"behind_easier", "quality_below_file", "uplink_full"}),
    ),
    # At home, HEVC converted is the player's codec, whatever else slows it.
    lifted(HEVC_UNSUPPORTED, Fix.OTHER_VERSION, explains=CONVERSION),
    LagCause(
        "behind_easier",
        Fix.OTHER_VERSION,
        _behind_easier,
        frozenset({"quality_below_file", "behind"}),
    ),
    LagCause(
        "quality_below_file", Fix.ORIGINAL_QUALITY, _quality_below_file, frozenset({"behind"})
    ),
    LagCause(
        "heavy_with_lighter",
        Fix.OTHER_VERSION,
        _heavy_with_lighter,
        frozenset({"heavy_stream", "uplink_full"}),
    ),
    LagCause("heavy_stream", Fix.LOWER_QUALITY, _heavy, frozenset({"uplink_full"})),
    LagCause("uplink_full", Fix.LOWER_QUALITY, _uplink_full),
    LagCause("behind", Fix.LOWER_QUALITY, _behind),
    LagCause("server_busy", Fix.WAIT, _busy),
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
    found = [(rule, said) for rule in LAG_CAUSES if (said := rule.find(stream)) is not None]
    kept = {rule.name for rule in unexplained(rule for rule, _ in found)}
    return Diagnosis(
        stream,
        tuple(Finding(rule.name, rule.fix, said) for rule, said in found if rule.name in kept),
    )


async def _versions(
    services: Services, host: str, session: Session, library: str | None
) -> tuple[TitleVersion, ...]:
    """A movie's versions, when the play came from the Plex server maester reads."""
    play = Play.from_session(host, session)
    if host != library or play.kind != "movie":
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
    library: str | None,
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
