"""Known player limits, as data: what each looks like in a play, and the fix to give.

Most "it won't play" reports are the player, not the file, and a working
file must never be deleted for a player's sake. So the player is checked
first: a play's facts (`Playback`, from `plays.py`) go through
`CLIENT_LIMITS`, a table of rules that each pair a match with the cause and
one concrete fix to tell the friend. Only when no rule matches does the
report go on to the file.

A rule matches a play, not a player model: Tautulli says what the server
had to do (transcode the video, burn in the subtitles, pass the audio
through), and that is what the rules read. Where one limit forces what
another rule looks for (burning in subtitles makes the server transcode the
video), the forcing rule `explains` the other, so the friend hears the real
cause once. A stream cut down to fit a connection (a lower quality asked
for, or Plex's relay) is transcoded whatever the player decodes, so the
codec rule leaves it to the lag rules (`maester/perf/lag.py`), which reuse
this table's rules and `unexplained`.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Protocol

from maester.playback.plays import Playback

# Subtitle formats that are pictures, not text: a player that can't draw them
# makes the server burn them into the video.
IMAGE_SUBTITLES = frozenset({"pgs", "hdmv_pgs_subtitle", "vobsub", "dvd_subtitle", "dvb_subtitle"})
# Lossless audio a player may pass through to a TV or receiver as-is (DTS is "dca" in Plex).
PASSTHROUGH_AUDIO = frozenset({"truehd", "dca", "dca-ma", "dts", "dts-hd"})
SENT_AS_IS = frozenset({"direct play", "copy"})
# Hardware known to play Dolby Vision profile 7, matched in its device or player name.
DV7_DEVICES = ("shield",)


@dataclass(frozen=True)
class ClientLimit:
    """One known limit: when it applies to a play, what it causes, and the fix."""

    name: str
    applies: Callable[[Playback], bool]
    cause: str
    fix: str
    explains: frozenset[str] = frozenset()  # rules this limit's own effects would trip

    def as_dict(self) -> dict[str, str]:
        return {"limit": self.name, "cause": self.cause, "fix": self.fix}


CLIENT_LIMITS: tuple[ClientLimit, ...] = (
    ClientLimit(
        "dolby_vision_profile_7",
        lambda p: p.dovi_profile == 7 and not any(d in p.hardware for d in DV7_DEVICES),
        "This copy is Dolby Vision profile 7, a Blu-ray format most players can't show: the "
        "picture turns purple or green, or it won't start.",
        "Play the 1080p version, or watch on a player that handles profile 7 (an Nvidia Shield).",
    ),
    ClientLimit(
        "hevc_unsupported",
        # A stream squeezed to fit a connection transcodes whatever the codec: that's lag.
        lambda p: p.video_codec == "hevc" and p.video_decision == "transcode" and not p.squeezed,
        "The player can't decode HEVC (H.265), so the server converts the video on the fly, "
        "which it can't keep up with.",
        "Pick the 1080p version, or use the Plex app on a newer device (a TV from 2017 on, an "
        "Apple TV 4K, a Shield or a recent Roku); web browsers usually can't play HEVC.",
    ),
    ClientLimit(
        "lossless_audio_passthrough",
        lambda p: p.audio_codec in PASSTHROUGH_AUDIO and p.audio_decision in SENT_AS_IS,
        "The audio is TrueHD or DTS and the player passes it straight through; a TV or "
        "soundbar that can't decode it gives no sound or stops the playback.",
        "In the Plex player's audio settings, turn passthrough off (or limit it to what your "
        "speakers support), or switch to another audio track.",
    ),
    ClientLimit(
        "image_subtitle_burn_in",
        lambda p: p.subtitle_decision == "burn" and p.subtitle_codec in IMAGE_SUBTITLES,
        "The subtitles are pictures (PGS), so the server has to burn them into the video and "
        "convert all of it, which often stalls.",
        "Turn subtitles off, or pick a text (SRT) subtitle track if there is one.",
        # Burning subtitles in forces the video to be transcoded, whatever the player decodes.
        explains=frozenset({"hevc_unsupported"}),
    ),
)


class Explaining(Protocol):
    """A rule that may account for what other rules see."""

    @property
    def name(self) -> str: ...
    @property
    def explains(self) -> frozenset[str]: ...


def unexplained[R: Explaining](matched: Iterable[R]) -> tuple[R, ...]:
    """The matched rules, in order, less those another matched rule explains."""
    matched = list(matched)
    explained = {name for rule in matched for name in rule.explains}
    return tuple(rule for rule in matched if rule.name not in explained)


def client_causes(playback: Playback) -> tuple[ClientLimit, ...]:
    """The limits this play ran into, in the table's order, less those another one explains."""
    return unexplained(limit for limit in CLIENT_LIMITS if limit.applies(playback))
