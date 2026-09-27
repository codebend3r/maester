"""How busy each Plex host is, and whether that could be why a stream lags.

Tautulli on each host says what its server is doing: its streams, which it
converts (transcodes), the bandwidth they take, and how fast each
conversion runs against real time. A conversion running slower than
playback, while the server isn't holding it back for being ahead, is the one
direct sign a server can't keep up, whatever its hardware. The fleet
monitor, where it is set up (`Services.fleet`), adds each NAS's CPU and
memory use; a host near the top of either is busy too.

Every host is asked at once, with the fleet monitor. A host that can't
answer is named rather than hiding the others, and the verdict says what
wasn't seen instead of calling it fine: yes, unlikely, or unknown. A
stream's own host is read without that stream (`without`), so a stream
falling behind on its own doesn't count as a busy server.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from typing import Any

from maester.clients import ClientError, Services
from maester.clients.fleet import FleetMonitor, Vitals
from maester.clients.tautulli import Activity, Session
from maester.formatting import mbps
from maester.playback.plays import Playback

# A conversion slower than this against real time can't keep the stream fed.
REAL_TIME = 1.0
# CPU or memory use, in percent, at which a NAS is too busy to serve smoothly.
BUSY_CPU_PERCENT = 85.0
BUSY_MEMORY_PERCENT = 90.0


def behind(playback: Playback) -> bool:
    """Its conversion runs slower than playback."""
    return playback.transcode_speed is not None and playback.transcode_speed < REAL_TIME


@dataclass(frozen=True)
class HostLoad:
    """One Plex host right now: its streams (Tautulli) and its CPU and memory, if read."""

    host: str
    activity: Activity
    vitals: Vitals | None  # None when the fleet monitor has no reading of it

    @property
    def playbacks(self) -> tuple[Playback, ...]:
        return tuple(Playback.from_session(s) for s in self.activity.sessions)

    @property
    def behind(self) -> int:
        """Conversions running slower than playback."""
        return sum(1 for p in self.playbacks if behind(p))

    @property
    def remote_kbps(self) -> int:
        """What its streams to friends away from the server send out, together."""
        return sum(p.bitrate_kbps for p in self.playbacks if p.remote)

    @property
    def measured(self) -> bool:
        """Both its CPU and its memory were read."""
        return self.vitals is not None and None not in (
            self.vitals.cpu_percent,
            self.vitals.memory_percent,
        )

    @property
    def strain(self) -> tuple[str, ...]:
        """Why it's busy, in words; empty when nothing seen says so."""
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

    def without(self, session: Session) -> HostLoad:
        """This host's load from its other streams."""
        others = tuple(s for s in self.activity.sessions if s.session_key != session.session_key)
        return replace(self, activity=replace(self.activity, sessions=others))

    def as_dict(self) -> dict[str, Any]:
        playbacks = self.playbacks
        facts: dict[str, Any] = {
            "streams": len(playbacks),
            "transcodes": sum(1 for p in playbacks if p.transcode_decision == "transcode"),
            "transcodes_behind": self.behind,
            "bandwidth_mbps": mbps(sum(s.bandwidth_kbps for s in self.activity.sessions)),
            "remote_streams": sum(1 for p in playbacks if p.remote),
            "remote_mbps": mbps(self.remote_kbps),
            "relayed_streams": sum(1 for p in playbacks if p.relayed),
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
    unknown when the fleet monitor gave none."""

    hosts: dict[str, HostLoad]
    unreachable: dict[str, str]  # host -> why its Tautulli couldn't answer
    vitals_note: str  # why there's no CPU or memory at all; empty when the monitor answered

    @property
    def remote_kbps(self) -> int:
        return sum(load.remote_kbps for load in self.hosts.values())

    @property
    def busy(self) -> tuple[HostLoad, ...]:
        return tuple(load for load in self.hosts.values() if load.busy)

    @property
    def plausible(self) -> bool | None:
        """Whether load could be the cause: yes, no, or unknown (a host went unseen)."""
        if self.busy:
            return True
        return None if self.unreachable else False

    def verdict(self) -> str:
        """Whether load could be why things are slow, in a sentence, saying what wasn't seen."""
        if self.busy:
            said = "; ".join(f"{load.host}: {', '.join(load.strain)}" for load in self.busy)
            return f"Yes, the server is busy ({said})."
        if not self.hosts:
            return "Unknown: no server's Tautulli answered."
        seen = ", ".join(sorted(self.hosts))
        said = f"every conversion on {seen} keeps up"
        unmeasured = sorted(host for host, load in self.hosts.items() if not load.measured)
        if not unmeasured:
            said += ", and their CPU and memory are fine"
        elif self.vitals_note:
            said += f" (CPU and memory {self.vitals_note})"
        else:
            said += f" (no recent CPU or memory reading for {', '.join(unmeasured)})"
        if self.unreachable:
            return f"Unknown: {said}, but {', '.join(sorted(self.unreachable))} couldn't be asked."
        return f"Unlikely: {said}."

    def as_dict(self) -> dict[str, Any]:
        reply: dict[str, Any] = {
            "hosts": {host: load.as_dict() for host, load in sorted(self.hosts.items())},
            "load_is_a_plausible_cause": self.plausible,
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
            case ClientError():
                unreachable[host] = str(activity)
            case BaseException():
                raise activity
    return Loads(loads, unreachable, note)
