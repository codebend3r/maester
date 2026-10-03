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
cause once. A stream that may be cut down to fit a connection (Plex's relay,
or sent away from home below the file's bitrate) is transcoded whatever the
player plays, so the HEVC rule leaves it to the lag rules
(`luwin/perf/lag.py`), which reuse two of this table's rules.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from luwin.playback.plays import Playback

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


DOLBY_VISION_PROFILE_7 = ClientLimit(
    "dolby_vision_profile_7",
    lambda p: p.dovi_profile == 7 and not any(d in p.hardware for d in DV7_DEVICES),
    "This copy is Dolby Vision profile 7, a Blu-ray format most players can't show: the "
    "picture turns purple or green, or it won't start.",
    "Play the 1080p version, or watch on a player that handles profile 7 (an Nvidia Shield).",
)
HEVC_UNSUPPORTED = ClientLimit(
    "hevc_unsupported",
    # A stream squeezed to fit a connection may transcode whatever the codec: that's lag.
    lambda p: p.video_codec == "hevc" and p.video_decision == "transcode" and not p.squeezed,
    "This player can't play this HEVC file as it is (its codec, HDR or 4K), so the server "
    "converts the video on the fly, which it can't keep up with.",
    "Pick the 1080p version, or use the Plex app on a newer device (a TV from 2017 on, an "
    "Apple TV 4K, a Shield or a recent Roku); web browsers usually can't play HEVC.",
)
LOSSLESS_AUDIO_PASSTHROUGH = ClientLimit(
    "lossless_audio_passthrough",
    lambda p: p.audio_codec in PASSTHROUGH_AUDIO and p.audio_decision in SENT_AS_IS,
    "The audio is TrueHD or DTS and the player passes it straight through; a TV or "
    "soundbar that can't decode it gives no sound or stops the playback.",
    "In the Plex player's audio settings, turn passthrough off (or limit it to what your "
    "speakers support), or switch to another audio track.",
)
IMAGE_SUBTITLE_BURN_IN = ClientLimit(
    "image_subtitle_burn_in",
    lambda p: p.subtitle_decision == "burn" and p.subtitle_codec in IMAGE_SUBTITLES,
    "The subtitles are pictures (PGS), so the server has to burn them into the video and "
    "convert all of it, which often stalls.",
    "Turn subtitles off, or pick a text (SRT) subtitle track if there is one.",
    # Burning subtitles in forces the video to be transcoded, whatever the player decodes.
    explains=frozenset({HEVC_UNSUPPORTED.name}),
)
CLIENT_LIMITS: tuple[ClientLimit, ...] = (
    DOLBY_VISION_PROFILE_7,
    HEVC_UNSUPPORTED,
    LOSSLESS_AUDIO_PASSTHROUGH,
    IMAGE_SUBTITLE_BURN_IN,
)


def client_causes(playback: Playback) -> tuple[ClientLimit, ...]:
    """The limits this play ran into, in the table's order, less those another one explains."""
    matched = [limit for limit in CLIENT_LIMITS if limit.applies(playback)]
    explained = {name for limit in matched for name in limit.explains}
    return tuple(limit for limit in matched if limit.name not in explained)
