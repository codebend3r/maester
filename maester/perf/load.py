"""How busy each Plex host is, and whether that could be why a stream lags.

Tautulli on each host says what its server is doing: how many streams, how
many it converts (transcodes), the bandwidth they take, and how fast each
conversion runs against real time. A conversion running slower than
playback, while the server isn't holding it back for being ahead, is the one
direct sign a server can't keep up, whatever its hardware. The fleet
monitor, where it is set up (`Services.fleet`), adds each NAS's CPU and
memory use; a host near the top of either is busy too.

Every host is asked at once, with the fleet monitor, and a host that can't
answer is named rather than hiding the others.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from maester.clients import ClientError, Services
from maester.clients.fleet import FleetMonitor, Vitals
from maester.clients.tautulli import Activity
from maester.playback.plays import Playback

# A conversion slower than this against real time can't keep the stream fed.
REAL_TIME = 1.0
# CPU or memory use, in percent, at which a NAS is too busy to serve smoothly.
BUSY_CPU_PERCENT = 85.0
BUSY_MEMORY_PERCENT = 90.0


def mbps(kbps: int) -> float:
    return round(kbps / 1000, 1)


@dataclass(frozen=True)
class HostLoad:
    """One Plex host right now: its streams (Tautulli) and its CPU and memory, if known."""

    host: str
    activity: Activity
    vitals: Vitals | None

    @property
    def playbacks(self) -> tuple[Playback, ...]:
        return tuple(Playback.from_session(s) for s in self.activity.sessions)

    @property
    def behind(self) -> int:
        """Conversions running slower than playback."""
        return sum(
            1
            for p in self.playbacks
            if p.transcode_speed is not None and p.transcode_speed < REAL_TIME
        )

    @property
    def remote_kbps(self) -> int:
        """What its streams to friends away from the server send out, together."""
        return sum(p.bitrate_kbps for p in self.playbacks if p.remote)

    @property
    def strain(self) -> tuple[str, ...]:
        """Why it's busy, in words; empty when it isn't."""
        reasons = []
        if self.behind:
            plural = "s" if self.behind > 1 else ""
            reasons.append(f"{self.behind} stream{plural} converting slower than playback")
        vitals = self.vitals or Vitals(None, None)
        if vitals.cpu_percent is not None and vitals.cpu_percent >= BUSY_CPU_PERCENT:
            reasons.append(f"its CPU is at {vitals.cpu_percent:.0f}%")
        if vitals.memory_percent is not None and vitals.memory_percent >= BUSY_MEMORY_PERCENT:
            reasons.append(f"its memory is {vitals.memory_percent:.0f}% used")
        return tuple(reasons)

    @property
    def busy(self) -> bool:
        return bool(self.strain)

    def as_dict(self) -> dict[str, Any]:
        activity = self.activity
        facts: dict[str, Any] = {
            "streams": activity.stream_count,
            "transcodes": activity.transcode_count,
            "transcodes_behind": self.behind,
            "bandwidth_mbps": mbps(activity.total_bandwidth_kbps),
            "remote_streams": sum(1 for p in self.playbacks if p.remote),
            "remote_mbps": mbps(self.remote_kbps),
            "relayed_streams": sum(1 for p in self.playbacks if p.relayed),
            "busy": self.busy,
        }
        if self.vitals is not None:
            facts["cpu_percent"] = self.vitals.cpu_percent
            facts["memory_percent"] = self.vitals.memory_percent
        if self.strain:
            facts["why_busy"] = list(self.strain)
        return facts


@dataclass(frozen=True)
class Loads:
    """Every Plex host's load, which hosts couldn't answer, and why CPU and memory are
    unknown when they are."""

    hosts: dict[str, HostLoad]
    unreachable: dict[str, str]  # host -> why its Tautulli couldn't answer
    vitals_note: str  # why there's no CPU or memory; empty when the monitor answered

    @property
    def remote_kbps(self) -> int:
        return sum(load.remote_kbps for load in self.hosts.values())

    @property
    def busy(self) -> tuple[HostLoad, ...]:
        return tuple(load for load in self.hosts.values() if load.busy)

    def verdict(self) -> str:
        """Whether load could be why things are slow, in a sentence."""
        if self.busy:
            said = "; ".join(f"{load.host}: {', '.join(load.strain)}" for load in self.busy)
            return f"Yes, the server is busy ({said})."
        checked = "every conversion keeps up"
        if not self.vitals_note:
            checked += ", and CPU and memory are fine"
        if self.unreachable:
            checked += f" ({', '.join(sorted(self.unreachable))} couldn't be asked)"
        return f"Unlikely: {checked}."

    def as_dict(self) -> dict[str, Any]:
        reply: dict[str, Any] = {
            "hosts": {host: load.as_dict() for host, load in sorted(self.hosts.items())},
            "load_is_a_plausible_cause": bool(self.busy),
            "verdict": self.verdict(),
        }
        if self.unreachable:
            reply["unreachable"] = self.unreachable
        if self.vitals_note:
            reply["cpu_and_memory"] = self.vitals_note
        return reply


async def _vitals(fleet: FleetMonitor | None) -> tuple[dict[str, Vitals], str]:
    if fleet is None:
        return {}, "unknown: no fleet monitor is set up"
    try:
        return await fleet.vitals(), ""
    except ClientError as exc:
        return {}, f"unknown: the fleet monitor didn't answer ({exc})"


async def read_loads(services: Services) -> Loads:
    """Every Plex host's load, all asked at once."""
    hosts = sorted(services.tautulli)
    activities, (vitals, note) = await asyncio.gather(
        asyncio.gather(*(services.tautulli[h].activity() for h in hosts), return_exceptions=True),
        _vitals(services.fleet),
    )
    loads, unreachable = {}, {}
    for host, activity in zip(hosts, activities, strict=True):
        match activity:
            case Activity():
                loads[host] = HostLoad(host, activity, vitals.get(host))
            case BaseException():
                unreachable[host] = f"{type(activity).__name__}: {activity}"
    return Loads(loads, unreachable, note)
