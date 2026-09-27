"""The fleet monitor (wizteros' `fleet-monitor`): each NAS's CPU and memory, when set up.

The monitor keeps every host's vitals as history (`/fleet/cpu`,
`/fleet/memory`, one series of points per host). maester reads those two
routes and nothing else, with a static bearer token (`FLEET_MONITOR_TOKEN`)
meant for a guard on the monitor that opens only them. The monitor has no
such guard yet (its routes want an admin's Supabase session, which also
reads every member's play history), so this stays unset until it does.

A host's vitals are the last point of a short window, so a host the
collector hasn't reached lately has none rather than an old number.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol

from maester.clients.base import ClientError, Downable, HttpClient

# The collector samples every 30 s; a reading older than this doesn't describe "now".
WINDOW_MINUTES = 5


@dataclass(frozen=True)
class Vitals:
    """One NAS's latest CPU and memory use, in percent; None when the window has no reading."""

    cpu_percent: float | None
    memory_percent: float | None


class FleetMonitor(Protocol):
    async def vitals(self) -> dict[str, Vitals]: ...
    async def ping(self) -> None: ...


class FleetMonitorClient(HttpClient):
    service = "fleet monitor"
    # One of the two routes the token opens, so a ping checks the token too.
    health_path = "/fleet/memory"

    def __init__(self, base_url: str, token: str, **kwargs: Any):
        super().__init__(base_url, headers={"Authorization": f"Bearer {token}"}, **kwargs)

    async def vitals(self) -> dict[str, Vitals]:
        cpu, memory = await asyncio.gather(self._latest("cpu"), self._latest("memory"))
        hosts = cpu.keys() | memory.keys()
        return {host: Vitals(cpu.get(host), memory.get(host)) for host in hosts}

    async def _latest(self, kind: str) -> dict[str, float]:
        """Each host's last reading of one metric family in the window."""
        path = f"/fleet/{kind}"
        data = await self.get_json(path, params={"minutes": WINDOW_MINUTES})
        try:
            return {
                h["name"]: float(h["points"][-1]["value"])
                for h in data.get("hosts") or []
                if h.get("points")
            }
        except (AttributeError, KeyError, TypeError, ValueError) as exc:
            raise ClientError(self.service, "GET", path, 200, f"unexpected shape: {exc}") from exc


@dataclass
class FakeFleetMonitor(Downable):
    service: ClassVar[str] = "fleet monitor"
    readings: dict[str, Vitals] = field(default_factory=dict)

    async def vitals(self) -> dict[str, Vitals]:
        self.refuse_if_down("/fleet/cpu")
        return dict(self.readings)
