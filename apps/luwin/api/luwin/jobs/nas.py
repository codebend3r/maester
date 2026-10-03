"""The weekly NAS health report: every NAS and media volume, anything degraded at the top.

Sent to the admin on `NAS_REPORT_DAY` at `DIGEST_TIME`. Each NAS
comes from the fleet monitor (`/fleet`), which watches all five: whether it
has been heard from, its `/volume1` usage, memory and load, the hottest chip
it reports, containers down or failing their healthcheck, and how much of
the last day it was up. The media volumes come from the arrs, as the digest
reads them. Anything past a limit goes under "Needs a look", the rest under
"Fine", and what couldn't be read is named at the end.

Drive SMART health isn't read: the fleet monitor has no SMART probe, and
luwin has no SSH (it runs no shell at all), so the report says so rather
than implying the drives are fine.
"""

from __future__ import annotations

from datetime import UTC, datetime

from luwin.clients import ClientError, Services
from luwin.clients.fleet import HostHealth
from luwin.config import Settings
from luwin.notify import AdminPost, Notice
from luwin.storage import read_space, terabytes

# Past these, a NAS needs a look.
DISK_PERCENT = 90.0
TEMPERATURE_C = 80.0
LOAD_PER_CORE = 1.0
UPTIME_PERCENT = 99.0

NO_SMART = (
    "Drive SMART health isn't read: the fleet monitor has no SMART probe yet, and luwin "
    "runs no SSH."
)


def problems(host: HostHealth) -> list[str]:
    """What's wrong with a NAS, as the fleet monitor judges it; empty when nothing is."""
    if not host.collected:
        return ["the fleet monitor hasn't heard from it in a day"]
    found = []
    if host.stale:
        found.append(f"its {host.stale} readings have gone quiet")
    if host.disk_percent is not None and host.disk_percent >= DISK_PERCENT:
        found.append(f"{host.disk_mount} is {host.disk_percent:g}% used")
    if host.temperatures and max(host.temperatures.values()) >= TEMPERATURE_C:
        sensor, hottest = max(host.temperatures.items(), key=lambda t: t[1])
        found.append(f"{sensor} is at {hottest:g}°C")
    if host.load_per_core is not None and host.load_per_core >= LOAD_PER_CORE:
        found.append(f"load is {host.load_per_core:.1f} per core")
    if host.uptime_percent_24h is not None and host.uptime_percent_24h < UPTIME_PERCENT:
        found.append(f"up only {host.uptime_percent_24h:g}% of the last day")
    found += [f"container {name} is down" for name in host.containers_down]
    found += [f"container {name} fails its healthcheck" for name in host.containers_unhealthy]
    return found


def vitals(host: HostHealth) -> str:
    """ "/volume1 62% used (31.0 TB free), memory 48%, load 0.3 per core, hottest 54°C"."""
    parts = []
    if host.disk_percent is not None:
        free = f" ({terabytes(host.disk_free_bytes)} free)" if host.disk_free_bytes else ""
        parts.append(f"{host.disk_mount} {host.disk_percent:g}% used{free}")
    if host.memory_percent is not None:
        parts.append(f"memory {host.memory_percent:g}%")
    if host.load_per_core is not None:
        parts.append(f"load {host.load_per_core:.1f} per core")
    if host.temperatures:
        parts.append(f"hottest {max(host.temperatures.values()):g}°C")
    if host.uptime_percent_24h is not None:
        parts.append(f"up {host.uptime_percent_24h:g}% of the last day")
    return ", ".join(parts) or "no readings"


async def nas_report(services: Services, settings: Settings) -> list[Notice]:
    degraded: list[str] = []
    fine: list[str] = []
    unread: list[str] = []
    if services.fleet is None:
        unread.append("The fleet monitor isn't set up, so no NAS's state or temperature is read.")
    else:
        try:
            hosts = await services.fleet.hosts()
        except ClientError as exc:
            unread.append(f"The fleet monitor didn't answer: {exc}")
        else:
            for host in sorted(hosts, key=lambda h: h.name):
                if found := problems(host):
                    degraded.append(f"{host.name}: {'; '.join(found)}. ({vitals(host)})")
                else:
                    fine.append(f"{host.name}: {vitals(host)}")
    space = await read_space(services)
    limit = settings.guardrails.storage_pause_4k_percent
    for volume in sorted(space.volumes, key=lambda v: -v.used_percent):
        (degraded if volume.used_percent >= limit else fine).append(volume.describe())
    unread += [f"{name}: {why}" for name, why in space.unreachable.items()]
    unread.append(NO_SMART)
    when = datetime.now(UTC).astimezone(settings.jobs.zone)
    blocks = [f"**Weekly NAS health, {when:%a %b %d}**"]
    for title, lines in (("Needs a look", degraded), ("Fine", fine), ("Not checked", unread)):
        if lines:
            blocks.append("\n".join([f"**{title}**", *(f"- {line}" for line in lines)]))
    return [AdminPost("\n\n".join(blocks))]
