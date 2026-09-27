"""Free space per volume, as the arrs see it.

Each arr reports its root folders (where it puts media) and the disks
mounted in its container. A root folder's volume is the disk it sits on
(the longest mount path it starts with), with that disk's free and total
bytes; a root folder on no listed disk stands for itself, with the space it
reported. Sonarr and Radarr on one host see the same mounts, and a NAS share
mounted on both hosts shows up on each, so volumes are merged when they have
the same path and size and nearly the same free space (one disk read moments
apart; two disks almost never agree that closely), and remember which hosts
and root folders sit on them.

Which host's arr couldn't answer is named rather than hiding the rest, and
a volume whose space no arr reported is left out: callers say it's unknown
rather than guess.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from maester.clients import ClientError, Services
from maester.clients.arr import DiskSpace, RootFolder
from maester.formatting import gigabytes

# How far apart two reads of one disk's free space may be: downloads move it between reads.
SAME_DISK_SLACK = 10_000_000_000


@dataclass(frozen=True)
class Volume:
    path: str  # the mount, as the arrs see it ("/Vermithor")
    free_bytes: int
    total_bytes: int
    hosts: tuple[str, ...]  # whose arrs see it
    roots: tuple[str, ...]  # root folders on it

    @property
    def used_percent(self) -> float:
        return round(100 * (1 - self.free_bytes / self.total_bytes), 1)

    @property
    def label(self) -> str:
        """ "/Vermithor (vermithor)", as the admin knows it."""
        return f"{self.path} ({', '.join(self.hosts)})"

    def describe(self) -> str:
        """ "/Vermithor (vermithor): 1.2 TB free of 40.0 TB, 97% used"."""
        return (
            f"{self.label}: {terabytes(self.free_bytes)} free of {terabytes(self.total_bytes)}, "
            f"{self.used_percent:g}% used"
        )

    def holds(self, root: str) -> bool:
        """Whether a root folder sits on this volume."""
        return root in self.roots or _under(root, self.path)


def terabytes(size: int) -> str:
    """Volumes read in TB; anything under one in GB."""
    return f"{size / 1e12:.1f} TB" if size >= 1e12 else gigabytes(size)


def _under(path: str, mount: str) -> bool:
    """Whether `path` is `mount` or inside it."""
    mount = mount.rstrip("/")
    return path == mount or path.startswith(mount + "/") or mount == ""


def _disk_of(root: str, disks: list[DiskSpace]) -> DiskSpace | None:
    """The disk a root folder sits on: the longest mount path it's under."""
    holding = [d for d in disks if d.total_bytes and _under(root, d.path)]
    return max(holding, key=lambda d: len(d.path.rstrip("/")), default=None)


def volumes_of(host: str, roots: list[RootFolder], disks: list[DiskSpace]) -> list[Volume]:
    """One arr's root folders as the volumes they sit on; a root with no space known is left out."""
    found = []
    for root in roots:
        if disk := _disk_of(root.path, disks):
            found.append(
                Volume(disk.path, disk.free_bytes, disk.total_bytes, (host,), (root.path,))
            )
        elif root.free_bytes is not None and root.total_bytes:
            found.append(
                Volume(root.path, root.free_bytes, root.total_bytes, (host,), (root.path,))
            )
    return found


def _same_disk(a: Volume, b: Volume) -> bool:
    return (
        (a.path.rstrip("/") or "/") == (b.path.rstrip("/") or "/")
        and a.total_bytes == b.total_bytes
        and abs(a.free_bytes - b.free_bytes) <= SAME_DISK_SLACK
    )


def merged(volumes: list[Volume]) -> list[Volume]:
    """One volume per disk, however many arrs and hosts see it; the least free wins."""
    found: list[Volume] = []
    for v in volumes:
        i = next((i for i, seen in enumerate(found) if _same_disk(seen, v)), None)
        if i is None:
            found.append(v)
            continue
        seen = found[i]
        found[i] = Volume(
            seen.path,
            min(seen.free_bytes, v.free_bytes),
            seen.total_bytes,
            tuple(sorted({*seen.hosts, *v.hosts})),
            tuple(sorted({*seen.roots, *v.roots})),
        )
    return sorted(found, key=lambda v: (v.path, v.hosts))


async def arr_volumes(host: str, arr: Any) -> list[Volume]:
    roots, disks = await asyncio.gather(arr.root_folders(), arr.disk_space())
    return volumes_of(host, roots, disks)


@dataclass(frozen=True)
class Space:
    volumes: tuple[Volume, ...]
    unreachable: dict[str, str]  # "Radarr on meleys" -> why

    def holding(self, host: str, root: str) -> Volume | None:
        """The volume a host's root folder sits on (the deepest mount), if its space is known."""
        on = [v for v in self.volumes if host in v.hosts and v.holds(root)]
        return max(on, key=lambda v: len(v.path.rstrip("/")), default=None)


async def read_space(services: Services) -> Space:
    """Every host's arrs asked at once, their volumes merged."""
    arrs = [
        (f"{label} on {host}", host, arr)
        for label, clients in (("Sonarr", services.sonarr), ("Radarr", services.radarr))
        for host, arr in sorted(clients.items())
    ]
    found = await asyncio.gather(
        *(arr_volumes(host, arr) for _, host, arr in arrs), return_exceptions=True
    )
    volumes: list[Volume] = []
    unreachable: dict[str, str] = {}
    for (name, _, _), result in zip(arrs, found, strict=True):
        if isinstance(result, ClientError):
            unreachable[name] = str(result)
        elif isinstance(result, BaseException):
            raise result
        else:
            volumes += result
    return Space(tuple(merged(volumes)), unreachable)
