"""How busy the servers are, and whether that could be why a stream lags.

The fleet monitor, where it is set up (`Services.fleet`), says each NAS's
CPU and memory use; a host near the top of either is busy. raven's live
streams (what it sends, how many it converts, how many go away from home)
are everyone's viewing, which raven shows its owner alone, so they are read
only when the admin asks (`read_loads` is handed a raven reader then).

The verdict says what wasn't seen instead of calling it fine: yes, unlikely,
or unknown. It says "fine" only of CPU and memory it actually read.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from sparrow.clients import ClientError
from sparrow.clients.fleet import FleetMonitor, Vitals
from sparrow.clients.raven import LiveStream, PlaybackMode, Raven
from sparrow.formatting import mbps

# CPU or memory use, in percent, at which a NAS is too busy to serve smoothly.
BUSY_CPU_PERCENT = 85.0
BUSY_MEMORY_PERCENT = 90.0


@dataclass(frozen=True)
class HostLoad:
    """One NAS's CPU and memory, as the fleet monitor last read them."""

    host: str
    vitals: Vitals

    @property
    def measured(self) -> bool:
        """Both its CPU and its memory were read."""
        return None not in (self.vitals.cpu_percent, self.vitals.memory_percent)

    @property
    def strain(self) -> tuple[str, ...]:
        """Its CPU or memory near the top, in words; empty when neither was read so."""
        vitals, reasons = self.vitals, []
        if vitals.cpu_percent is not None and vitals.cpu_percent >= BUSY_CPU_PERCENT:
            reasons.append(f"its CPU is at {vitals.cpu_percent:.0f}%")
        if vitals.memory_percent is not None and vitals.memory_percent >= BUSY_MEMORY_PERCENT:
            reasons.append(f"its memory is {vitals.memory_percent:.0f}% used")
        return tuple(reasons)

    def as_dict(self) -> dict[str, Any]:
        facts: dict[str, Any] = {
            "cpu_percent": self.vitals.cpu_percent,
            "memory_percent": self.vitals.memory_percent,
            "busy": bool(self.strain),
        }
        if self.strain:
            facts["why_busy"] = list(self.strain)
        return facts


@dataclass(frozen=True)
class Streaming:
    """What raven is sending right now, every viewer's streams together."""

    streams: tuple[LiveStream, ...]

    def as_dict(self) -> dict[str, Any]:
        streams = self.streams
        return {
            "streams": len(streams),
            "transcodes": sum(1 for s in streams if s.mode == PlaybackMode.TRANSCODE),
            "remuxes": sum(1 for s in streams if s.mode == PlaybackMode.REMUX),
            "away_from_home": sum(1 for s in streams if s.remote),
            "sending_mbps": mbps(sum(s.send_kbps or 0 for s in streams)),
        }


@dataclass(frozen=True)
class Loads:
    """Each NAS's load where the fleet monitor read it, and raven's streams when read."""

    hosts: dict[str, HostLoad]
    vitals_note: str  # why there's no CPU or memory at all; empty when the monitor answered
    streaming: Streaming | None = None
    streaming_note: str = ""  # why raven's streams weren't read, when asked for

    @property
    def busy(self) -> tuple[HostLoad, ...]:
        return tuple(load for load in self.hosts.values() if load.strain)

    @property
    def plausible(self) -> bool | None:
        """Whether load could be the cause: yes, no, or unknown (nothing was read)."""
        if self.busy:
            return True
        return False if self.hosts and all(h.measured for h in self.hosts.values()) else None

    def verdict(self) -> str:
        """Whether load could be why things are slow, in a sentence, saying what wasn't seen."""
        if self.busy:
            said = "; ".join(f"{load.host}: {', '.join(load.strain)}" for load in self.busy)
            return f"Yes, the server is busy ({said})."
        if not self.hosts:
            return f"Unknown: CPU and memory are {self.vitals_note or 'unknown'}."
        unmeasured = sorted(host for host, load in self.hosts.items() if not load.measured)
        seen = ", ".join(sorted(self.hosts))
        if unmeasured:
            return (
                f"Unknown: no recent CPU or memory reading for {', '.join(unmeasured)}, "
                f"and nothing seen on {seen} is busy."
            )
        return f"Unlikely: CPU and memory on {seen} are fine."

    def as_dict(self) -> dict[str, Any]:
        reply: dict[str, Any] = {
            "hosts": {host: load.as_dict() for host, load in sorted(self.hosts.items())},
            "load_is_a_plausible_cause": self.plausible,
            "verdict": self.verdict(),
        }
        if self.vitals_note:
            reply["cpu_and_memory"] = self.vitals_note
        if self.streaming is not None:
            reply["raven"] = self.streaming.as_dict()
        if self.streaming_note:
            reply["raven"] = self.streaming_note
        return reply


async def _vitals(fleet: FleetMonitor | None) -> tuple[dict[str, Vitals], str]:
    if fleet is None:
        return {}, "unknown: no fleet monitor is set up"
    try:
        return await fleet.vitals(), ""
    except ClientError as exc:
        return {}, f"unknown: the fleet monitor didn't answer ({exc})"


async def _streaming(raven: Raven | None) -> tuple[Streaming | None, str]:
    if raven is None:
        return None, ""
    try:
        return Streaming(tuple(await raven.streams())), ""
    except ClientError as exc:
        return None, f"raven's streams couldn't be read ({exc})"


async def read_loads(fleet: FleetMonitor | None, raven: Raven | None = None) -> Loads:
    """Each NAS's load and, with a reader for raven's owner, raven's streams, asked at once."""
    (vitals, note), (streaming, streaming_note) = await asyncio.gather(
        _vitals(fleet), _streaming(raven)
    )
    hosts = {host: HostLoad(host, v) for host, v in vitals.items()}
    return Loads(hosts, note, streaming, streaming_note)
