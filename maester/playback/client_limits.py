"""Known player limits, as data: what each looks like in a play, and the fix to give.

Most "it won't play" reports are the player, not the file, and a working
file must never be deleted for a player's sake. So the client is checked
first: a play's facts (`Playback`: the client, the source's codecs, the
server's decision on each stream) go through `CLIENT_LIMITS`, a table of
rules that each pair a match with the cause and one concrete fix to tell
the friend. Only when no rule matches does the report go on to the file.

A rule matches a play, not a player model: Tautulli says what the server
had to do (transcode the video, burn in the subtitles, pass the audio
through), and that is what the rules read. The performance epic reuses the
same table to explain lag.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Any

from maester.clients.tautulli import HistoryRow, Session, StreamData

# Subtitle formats that are pictures, not text: a player that can't draw them
# makes the server burn them into the video.
IMAGE_SUBTITLES = frozenset({"pgs", "hdmv_pgs_subtitle", "vobsub", "dvd_subtitle", "dvb_subtitle"})
# Lossless audio a player may pass through to a TV or receiver as-is (DTS is "dca" in Plex).
PASSTHROUGH_AUDIO = frozenset({"truehd", "dca", "dca-ma", "dts", "dts-hd"})
SENT_AS_IS = frozenset({"direct play", "copy"})
# Hardware known to play Dolby Vision profile 7, matched in its device or player name.
DV7_DEVICES = ("shield",)


@dataclass(frozen=True)
class Playback:
    """One play's facts: the client, what the file holds, and what the server did with it."""

    platform: str  # "Roku", "Chrome", "Android"
    product: str  # "Plex for Roku", "Plex Web"
    player: str  # the player's name, often the hardware's: "SHIELD Android TV"
    device: str  # the hardware, from a live session; empty for a finished play
    container: str
    video_codec: str
    video_decision: str  # "direct play" | "copy" | "transcode"
    dovi_profile: int | None  # the file's Dolby Vision profile: 0 for none, None if unknown
    audio_codec: str
    audio_decision: str
    subtitle_codec: str
    subtitle_decision: str  # adds "burn"; empty without subtitles

    @classmethod
    def from_session(cls, s: Session) -> Playback:
        """A live play: Tautulli knows all of it, the file's Dolby Vision profile included."""
        return cls(
            platform=s.platform,
            product=s.product,
            player=s.player,
            device=s.device,
            container=s.container,
            video_codec=s.video_codec,
            video_decision=s.video_decision,
            dovi_profile=s.dovi_profile,
            audio_codec=s.audio_codec,
            audio_decision=s.audio_decision,
            subtitle_codec=s.subtitle_codec,
            subtitle_decision=s.subtitle_decision,
        )

    @classmethod
    def from_history(
        cls, row: HistoryRow, stream: StreamData, dovi_profile: int | None
    ) -> Playback:
        """A finished play: its history row and stream data, with the profile read from the file."""
        return cls(
            platform=row.platform,
            product=row.product,
            player=row.player,
            device="",
            container=stream.container,
            video_codec=stream.video_codec,
            video_decision=stream.video_decision,
            dovi_profile=dovi_profile,
            audio_codec=stream.audio_codec,
            audio_decision=stream.audio_decision,
            subtitle_codec=stream.subtitle_codec,
            subtitle_decision=stream.subtitle_decision,
        )

    @property
    def hardware(self) -> str:
        """What names the hardware: the device, and the player's name, which often says it."""
        return f"{self.device} {self.player}".lower()

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ClientLimit:
    """One known limit: when it applies to a play, what it causes, and the fix."""

    name: str
    applies: Callable[[Playback], bool]
    cause: str
    fix: str

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
        lambda p: p.video_codec == "hevc" and p.video_decision == "transcode",
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
    ),
)


def client_causes(playback: Playback) -> tuple[ClientLimit, ...]:
    """Every known limit this play ran into, in the table's order."""
    return tuple(limit for limit in CLIENT_LIMITS if limit.applies(playback))
