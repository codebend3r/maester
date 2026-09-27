"""Which arr instance holds a title's standard or 4K copy: one rule, never guessed.

A title with a 1080p and a 4K copy lives in two arrs, so ownership is asked
per copy. Seerr records, for each copy it sent, which of its Radarr/Sonarr
servers took it (`serviceId`, `serviceId4k`) and the title's id there
(`externalServiceId`, `externalServiceId4k`). Each Seerr server is matched
to the registry host whose client points at the same address (host, port,
base path), so both copies resolve to the right instance.

A title Seerr never sent anywhere (added straight to an arr) has no record.
For its standard copy, every instance that is not one of Seerr's 4K
servers is asked by TMDB id (Radarr) or TVDB id (Sonarr). Without a record
for the 4K copy, there is no 4K copy in an arr.

Whatever cannot be settled this way is refused with `OwnerUnknown`, never
guessed: a Seerr server that matches no configured instance (or two), two
instances holding the title, an instance that cannot answer.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from maester.clients import Services
from maester.clients.arr import MediaFile
from maester.clients.radarr import Radarr
from maester.clients.seerr import ArrServer, MediaDetails
from maester.clients.sonarr import Sonarr

_DEFAULT_PORTS = {"http": 80, "https": 443}


class OwnerUnknown(LookupError):
    """Which instance holds the copy can't be settled; the message says why."""


@dataclass(frozen=True)
class Owner:
    host: str
    kind: str  # "movie" | "tv"
    media_id: int  # the movie's or series' id in that arr
    arr: Radarr | Sonarr

    async def files(self) -> list[MediaFile]:
        if self.kind == "movie":
            return await self.arr.movie_files(self.media_id)  # type: ignore[union-attr]
        return await self.arr.episode_files(self.media_id)  # type: ignore[union-attr]


def _address(url: str) -> tuple[str, int, str]:
    parts = urlsplit(url)
    port = parts.port or _DEFAULT_PORTS.get(parts.scheme, 0)
    return (parts.hostname or "").lower(), port, parts.path.rstrip("/")


class Library:
    """Seerr's Radarr and Sonarr servers, matched to registry hosts once per lookup batch."""

    def __init__(self, services: Services, servers: Mapping[str, list[ArrServer]]):
        self.services = services
        self.servers = servers

    @classmethod
    async def load(cls, services: Services) -> Library:
        radarr, sonarr = await asyncio.gather(
            services.seerr.servers("radarr"), services.seerr.servers("sonarr")
        )
        return cls(services, {"movie": radarr, "tv": sonarr})

    def clients(self, kind: str) -> Mapping[str, Any]:
        return self.services.radarr if kind == "movie" else self.services.sonarr

    def host_of(self, kind: str, server: ArrServer) -> str:
        """The registry host whose client points where Seerr's server does."""
        want = _address(server.url)
        hosts = [h for h, c in self.clients(kind).items() if _address(c.base_url) == want]
        if len(hosts) != 1:
            found = " and ".join(sorted(hosts)) or "no configured instance"
            raise OwnerUnknown(f"Seerr's {server.name} ({server.url}) matches {found}")
        return hosts[0]

    async def owner(self, details: MediaDetails, *, is_4k: bool) -> Owner | None:
        """The instance holding this copy of the title, or None when no arr has it."""
        kind = details.media_type
        ref = details.arr_for(is_4k)
        if ref is not None:
            server = next((s for s in self.servers[kind] if s.id == ref.server_id), None)
            if server is None:
                raise OwnerUnknown(
                    f"Seerr sent it to a server it no longer lists ({ref.server_id})"
                )
            host = self.host_of(kind, server)
            return Owner(host, kind, ref.media_id, self.clients(kind)[host])
        if is_4k:
            return None
        return await self._ask_standard_instances(details)

    async def _ask_standard_instances(self, details: MediaDetails) -> Owner | None:
        kind = details.media_type
        if kind == "tv" and details.tvdb_id is None:
            return None
        uhd = {self.host_of(kind, s) for s in self.servers[kind] if s.is_4k}
        clients = {h: c for h, c in sorted(self.clients(kind).items()) if h not in uhd}

        async def lookup(client: Any) -> Any:
            if kind == "movie":
                return await client.movie_by_tmdb(details.tmdb_id)
            return await client.series_by_tvdb(details.tvdb_id)

        found = await asyncio.gather(*map(lookup, clients.values()), return_exceptions=True)
        owners = []
        for host, item in zip(clients, found, strict=True):
            if isinstance(item, Exception):
                raise OwnerUnknown(f"couldn't ask the {kind} arr on {host}: {item}") from item
            if item is not None:
                owners.append(Owner(host, kind, item.id, clients[host]))
        if len(owners) > 1:
            hosts = " and ".join(o.host for o in owners)
            raise OwnerUnknown(f"{hosts} both have it; can't tell which one is meant")
        return owners[0] if owners else None
