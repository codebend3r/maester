"""The file health check: is this file broken, measured rather than assumed.

After ffprobe's read (`maester/clients/media.py`), a few short stretches are
decoded: around the moment a friend named ("freezes at 1:12:30"), or else
at the start, the middle and near the end. The verdict is one of four, with
the evidence, and follows the maintainer's library audit
(`movie-completeness-audit`):

- `truncated`: it runs under 70% of the title's runtime, it ends before the
  moment named, or a stretch inside its claimed length decodes nothing
- `corrupt`: decoding prints errors that aren't known harmless noise
- `unreadable`: it can't be judged (missing on the mount, outside the media
  roots, a format ffmpeg can't parse, a check that ran out of time)
- `ok`: every stretch decoded cleanly

Only `truncated` and `corrupt` count as a failed check. `unreadable` never
justifies a replacement: a missing mount looks the same as a missing file.
"""

from __future__ import annotations

import asyncio
import enum
import re
from dataclasses import dataclass
from typing import Any

from maester.clients.media import Decoded, Inspection, MediaProbe, Unreadable

WINDOW = 10.0  # seconds decoded per stretch
AROUND = 15.0  # seconds decoded either side of a moment a friend named
SHORT = 0.7  # under this share of the runtime, a feature is half downloaded
EVIDENCE_LINES = 3
# ffmpeg chatter the audit found harmless.
NOISE = re.compile(
    "|".join(
        (
            r"Referenced QT chapter track not found",
            r"ignoring pic cod ext after",
            r"SEI type \d+ size \d+ truncated",
            r"bits \d+ is invalid",
            r"first frame is no keyframe",
        )
    )
)
# ffmpeg can't parse this variant; other players may still play the file.
UNSUPPORTED = re.compile(r"Not yet implemented in FFmpeg")


class Verdict(enum.StrEnum):
    OK = "ok"
    TRUNCATED = "truncated"
    CORRUPT = "corrupt"
    UNREADABLE = "unreadable"

    @property
    def failed(self) -> bool:
        """The check found the file broken, which can justify replacing it."""
        return self in (Verdict.TRUNCATED, Verdict.CORRUPT)


# Which verdict wins when stretches disagree.
SEVERITY = (Verdict.TRUNCATED, Verdict.CORRUPT, Verdict.UNREADABLE)


@dataclass(frozen=True)
class Health:
    verdict: Verdict
    evidence: tuple[str, ...]

    @classmethod
    def unreadable(cls, why: Unreadable) -> Health:
        return cls(Verdict.UNREADABLE, (str(why),))

    @property
    def summary(self) -> str:
        return f"{self.verdict}: {'; '.join(self.evidence)}"

    def as_dict(self) -> dict[str, Any]:
        return {"verdict": str(self.verdict), "evidence": list(self.evidence)}


@dataclass(frozen=True)
class Finding:
    verdict: Verdict
    evidence: str


def clock(seconds: float) -> str:
    """1:12:30, or 12:30 under an hour."""
    minutes, secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def parse_clock(text: str) -> float:
    """ "1:12:30" or "72:30" as seconds."""
    parts = text.strip().split(":")
    if not 2 <= len(parts) <= 3 or not all(p.isdigit() for p in parts):
        raise ValueError(f"{text!r} isn't a time like 1:12:30")
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return float(seconds)


@dataclass(frozen=True)
class Window:
    start: float
    length: float

    def __str__(self) -> str:
        return f"{clock(self.start)}-{clock(self.start + self.length)}"


def decode_windows(duration: float, at: float | None) -> tuple[Window, ...]:
    """Where to decode: around the moment named, or the start, middle and end."""
    if at is not None:
        start = min(max(at - AROUND, 0.0), max(duration - 2 * AROUND, 0.0))
        return (Window(start, 2 * AROUND),)
    starts = (0.0, duration / 2, max(duration - 3 * WINDOW, 0.0))
    return tuple(dict.fromkeys(Window(s, WINDOW) for s in starts))


def length_findings(duration: float, at: float | None, expected: float | None) -> list[Finding]:
    """What the file's length alone says, against the runtime and the moment named."""
    findings = []
    if expected and duration < SHORT * expected:
        findings.append(
            Finding(
                Verdict.TRUNCATED,
                f"it runs {clock(duration)}, well short of the {clock(expected)} runtime",
            )
        )
    if at is not None and at > duration:
        findings.append(
            Finding(Verdict.TRUNCATED, f"it ends at {clock(duration)}, before {clock(at)}")
        )
    return findings


def judge(window: Window, decoded: Decoded, duration: float) -> list[Finding]:
    """What decoding one stretch says about the file."""
    if decoded.exit_code is None:
        return [Finding(Verdict.UNREADABLE, f"decoding {window} ran out of time")]
    errors = [line for line in decoded.errors if not NOISE.search(line)]
    if unsupported := next((e for e in errors if UNSUPPORTED.search(e)), None):
        return [
            Finding(
                Verdict.UNREADABLE,
                f"ffmpeg can't decode this format ({unsupported}); other players may",
            )
        ]
    findings = []
    if errors:
        shown = " | ".join(errors[:EVIDENCE_LINES])
        findings.append(Finding(Verdict.CORRUPT, f"decode errors at {window}: {shown}"))
    if decoded.exit_code != 0:
        stopped = f"ffmpeg stopped at {window} with exit code {decoded.exit_code}"
        return findings or [Finding(Verdict.UNREADABLE, stopped)]
    if decoded.frames == 0 and window.start < duration:
        findings.append(
            Finding(
                Verdict.TRUNCATED,
                f"nothing decodes at {window}, though the file claims to run {clock(duration)}",
            )
        )
    return findings


def verdict_of(findings: list[Finding], windows: tuple[Window, ...]) -> Health:
    """The worst finding decides; every finding is evidence."""
    for verdict in SEVERITY:
        if any(f.verdict is verdict for f in findings):
            ranked = sorted(findings, key=lambda f: SEVERITY.index(f.verdict))
            return Health(verdict, tuple(f.evidence for f in ranked))
    stretches = ", ".join(str(w) for w in windows)
    return Health(Verdict.OK, (f"decoded {stretches} cleanly",))


async def check_health(
    probe: MediaProbe,
    inspection: Inspection,
    *,
    at: float | None = None,
    expected: float | None = None,
) -> Health:
    """Judge a file from its length and a short decode; `expected` is the runtime in seconds."""
    unsupported = [w for w in inspection.warnings if UNSUPPORTED.search(w)]
    if unsupported:
        why = f"ffprobe can't parse this format ({unsupported[0]}); other players may"
        return Health(Verdict.UNREADABLE, (why,))
    windows = decode_windows(inspection.duration, at)
    decoded = await asyncio.gather(
        *(probe.decode(inspection.path, w.start, w.length) for w in windows)
    )
    findings = length_findings(inspection.duration, at, expected)
    for window, result in zip(windows, decoded, strict=True):
        findings.extend(judge(window, result, inspection.duration))
    return verdict_of(findings, windows)
