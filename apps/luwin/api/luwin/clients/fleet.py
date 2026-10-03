"""The fleet monitor (wizteros' `fleet-monitor`): each NAS's vitals and health, when set up.

The monitor keeps every host's vitals as history (`/fleet/cpu`,
`/fleet/memory`, one series of points per host), and its judgment of each
host now (`/fleet`: reachable or not, `/volume1` usage, chip temperatures,
containers, uptime over the last day). luwin reads those three routes and
nothing else, with a static bearer token (`FLEET_MONITOR_TOKEN`) meant for a
guard on the monitor that opens only them. The monitor has no such guard
yet (its routes want an admin's Supabase session, which also reads every
member's play history), so this stays unset until it does.

A host's vitals are the last point of a short window, so a host the
collector hasn't reached lately has none rather than an old number.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol

from luwin.clients.base import ClientError, Downable, HttpClient

# The collector samples every 30 s; a reading older than this doesn't describe "now".
WINDOW_MINUTES = 5


@dataclass(frozen=True)
class Vitals:
    """One NAS's latest CPU and memory use, in percent; None when the window has no reading."""

    cpu_percent: float | None
    memory_percent: float | None


@dataclass(frozen=True)
class HostHealth:
    """One NAS as the fleet monitor judges it now (`/fleet`)."""

    name: str
    collected: bool  # False when the collector has no recent reading at all
    status: str  # ok | warn | unknown
    disk_mount: str = "/volume1"
    disk_percent: float | None = None
    disk_free_bytes: int | None = None
    memory_percent: float | None = None
    load_per_core: float | None = None
    uptime_percent_24h: float | None = None
    stale: str | None = None  # the family of readings gone quiet, when one has
    temperatures: dict[str, float] = field(default_factory=dict)  # chip sensor -> °C
    containers_down: tuple[str, ...] = ()
    containers_unhealthy: tuple[str, ...] = ()

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> HostHealth:
        metrics = raw.get("metrics") or {}
        containers = raw.get("containers") or []
        free = raw.get("disk_available_bytes")
        return cls(
            name=raw["name"],
            collected=bool(raw.get("collected")),
            status=raw.get("status") or "unknown",
            disk_mount=raw.get("disk_mount") or "/volume1",
            disk_percent=raw.get("disk_percent"),
            disk_free_bytes=int(free) if free is not None else None,
            memory_percent=raw.get("memory_percent"),
            load_per_core=raw.get("load_per_core"),
            uptime_percent_24h=raw.get("uptime_percent_24h"),
            stale=raw.get("stalest_family") if raw.get("metrics_stale") else None,
            temperatures={
                name.removeprefix("temp."): float(value)
                for name, value in metrics.items()
                if name.startswith("temp.")
            },
            containers_down=tuple(c["name"] for c in containers if not c.get("up")),
            containers_unhealthy=tuple(
                c["name"]
                for c in containers
                if c.get("up") and c.get("has_healthcheck") and not c.get("healthy")
            ),
        )


class FleetMonitor(Protocol):
    async def vitals(self) -> dict[str, Vitals]: ...
    async def hosts(self) -> list[HostHealth]: ...
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

    async def hosts(self) -> list[HostHealth]:
        """Every NAS the monitor watches, as it judges them now."""
        data = await self.get_json("/fleet")
        try:
            return [HostHealth.from_api(h) for h in data.get("hosts") or []]
        except (AttributeError, KeyError, TypeError, ValueError) as exc:
            raise ClientError(
                self.service, "GET", "/fleet", 200, f"unexpected shape: {exc}"
            ) from exc

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
    health: list[HostHealth] = field(default_factory=list)

    async def vitals(self) -> dict[str, Vitals]:
        self.refuse_if_down("/fleet/cpu")
        return dict(self.readings)

    async def hosts(self) -> list[HostHealth]:
        self.refuse_if_down("/fleet")
        return list(self.health)
