"""Which host's arr owns a title, found by asking every instance, never guessed.

Two stacks each run their own Radarr and Sonarr. A title belongs to the one
instance that has it in its library, matched by TMDB id (Radarr) or TVDB id
(Sonarr); every instance is asked at once. When more than one has it, which
one is meant cannot be told from the id alone, so the lookup refuses with
`AmbiguousOwner` rather than pick one, the same rule `registry.py` applies
to paths. An instance that cannot be reached fails the lookup too: without
its answer, "the other one owns it" would be a guess.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass

from maester.clients import Services
from maester.clients.radarr import Movie
from maester.clients.sonarr import Series


class AmbiguousOwner(LookupError):
    def __init__(self, service: str, hosts: list[str]):
        self.service, self.hosts = service, hosts
        super().__init__(
            f"{service} on {' and '.join(hosts)} both have this title; "
            "cannot tell which one is meant"
        )


@dataclass(frozen=True)
class Owned[T]:
    host: str
    item: T


async def movie_owner(services: Services, tmdb_id: int) -> Owned[Movie] | None:
    """The Radarr that has this movie, or None when no instance does."""
    return await _owner("radarr", services.radarr, lambda c: c.movie_by_tmdb(tmdb_id))


async def series_owner(services: Services, tvdb_id: int) -> Owned[Series] | None:
    """The Sonarr that has this show, or None when no instance does."""
    return await _owner("sonarr", services.sonarr, lambda c: c.series_by_tvdb(tvdb_id))


async def _owner[C, T](
    service: str, clients: Mapping[str, C], lookup: Callable[[C], Awaitable[T | None]]
) -> Owned[T] | None:
    hosts = sorted(clients)
    found = await asyncio.gather(*(lookup(clients[h]) for h in hosts))
    owners = [Owned(h, item) for h, item in zip(hosts, found, strict=True) if item is not None]
    if len(owners) > 1:
        raise AmbiguousOwner(service, [o.host for o in owners])
    return owners[0] if owners else None
