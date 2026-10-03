"""The file health check: is this file broken, measured rather than assumed.

After ffprobe's read (`maester/clients/media.py`), a few short stretches are
decoded: around the moment a friend named ("freezes at 1:12:30"), or else
at the start, the middle and near the end. The verdict is one of four, with
the evidence, and follows the maintainer's library audit
(`movie-completeness-audit`):

- `truncated`: it runs under 70% of the title's runtime, or a stretch
  inside its claimed length decodes nothing
- `corrupt`: decoding prints a known sign of a damaged stream (`CORRUPTION`)
- `unreadable`: it can't be judged: missing on the mount, outside the media
  roots, a read error, a decoder or format ffmpeg lacks, a check that ran out
  of time, or anything ffmpeg printed that is neither known noise nor a
  known sign of damage
- `ok`: every stretch decoded cleanly

Only `truncated` and `corrupt` count as a failed check, and only the file
itself can produce them: nothing a friend says does. A moment named past the
file's end is noted, not counted (the stretch decoded is then the file's
end, which shows whether it's hollow). `unreadable` never justifies a
replacement: a flaky mount must not look like a broken file.
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
# What a damaged stream makes ffmpeg's decoders say. Only these prove corruption;
# any other line (a read error, a missing decoder, something new) proves nothing.
CORRUPTION = re.compile(
    "|".join(
        (
            r"Invalid NAL unit size",
            r"error while decoding MB",
            r"corrupt decoded frame",
            r"Invalid data found when processing input",
            r"concealing \d+ DC, \d+ AC, \d+ MV errors",
            r"Packet corrupt",
        )
    ),
    re.IGNORECASE,
)
# ffprobe can't parse this variant; other players may still play the file.
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

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> Health:
        """A check stored with a report (`as_dict`)."""
        return cls(Verdict(raw["verdict"]), tuple(raw["evidence"]))

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
    """What the file's length alone says against the runtime; a moment named is only noted."""
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
            Finding(Verdict.OK, f"the moment named, {clock(at)}, is past its {clock(duration)}")
        )
    return findings


def _shown(lines: list[str]) -> str:
    return " | ".join(lines[:EVIDENCE_LINES])


def judge(window: Window, decoded: Decoded, duration: float) -> list[Finding]:
    """What decoding one stretch says about the file."""
    if decoded.exit_code is None:
        return [Finding(Verdict.UNREADABLE, f"decoding {window} ran out of time")]
    said = [line for line in decoded.errors if not NOISE.search(line)]
    damage = [line for line in said if CORRUPTION.search(line)]
    unclear = [line for line in said if not CORRUPTION.search(line)]
    findings = []
    if damage:
        findings.append(Finding(Verdict.CORRUPT, f"decode errors at {window}: {_shown(damage)}"))
    if unclear:
        findings.append(
            Finding(
                Verdict.UNREADABLE,
                f"ffmpeg at {window} said what proves nothing: {_shown(unclear)}",
            )
        )
    if decoded.exit_code != 0:
        stopped = f"ffmpeg stopped at {window} with exit code {decoded.exit_code}"
        return findings or [Finding(Verdict.UNREADABLE, stopped)]
    if unclear:  # frames missing after a read error say nothing about the file
        return findings
    if decoded.frames == 0 and window.start < duration:
        findings.append(
            Finding(
                Verdict.TRUNCATED,
                f"nothing decodes at {window}, though the file claims to run {clock(duration)}",
            )
        )
    return findings


def verdict_of(findings: list[Finding], windows: tuple[Window, ...]) -> Health:
    """The worst finding decides; every finding is evidence, notes last."""
    ranked = [*SEVERITY, Verdict.OK]
    evidence = tuple(f.evidence for f in sorted(findings, key=lambda f: ranked.index(f.verdict)))
    for verdict in SEVERITY:
        if any(f.verdict is verdict for f in findings):
            return Health(verdict, evidence)
    stretches = ", ".join(str(w) for w in windows)
    return Health(Verdict.OK, (f"decoded {stretches} cleanly", *evidence))


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
    decoded = await asyncio.gather(*(probe.decode(inspection, w.start, w.length) for w in windows))
    findings = length_findings(inspection.duration, at, expected)
    for window, result in zip(windows, decoded, strict=True):
        findings.extend(judge(window, result, inspection.duration))
    return verdict_of(findings, windows)
