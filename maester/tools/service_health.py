"""Is Plex down? Every service behind the server, asked at once whether it answers.

Each client has one liveness call, `ping`, on the cheapest route that shows
the service is up (and, where the route needs it, that maester's key still
works). Every service is pinged at once, each under its own `PING_TIMEOUT`,
so one that hangs can't hold up the answer or hide the others. The answer
is kept for `HEALTH_TTL` in the memo, so friends asking together at
midnight ping each service once.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Protocol

from maester.agent.tools import Tier, ToolContext, tool
from maester.clients import ClientError, Services
from maester.formatting import ago
from maester.memo import Key

# How long one service may take to answer before it counts as down.
PING_TIMEOUT = 5.0
# How long an answer is reused.
HEALTH_TTL = timedelta(seconds=60)


class Pingable(Protocol):
    async def ping(self) -> None: ...


@dataclass(frozen=True)
class Check:
    service: str  # "Plex", "Sonarr on meleys"
    down: str  # why it's down; empty when it answered


def named(services: Services) -> list[tuple[str, Pingable]]:
    """Every service maester uses, by the name people know it by."""
    found: list[tuple[str, Pingable]] = [
        ("Plex", services.plex),
        ("Seerr", services.seerr),
        ("Wizarr", services.wizarr),
    ]
    per_host: tuple[tuple[str, Mapping[str, Pingable]], ...] = (
        ("Sonarr", services.sonarr),
        ("Radarr", services.radarr),
        ("SABnzbd", services.sabnzbd),
        ("Tautulli", services.tautulli),
    )
    for label, clients in per_host:
        found += [(f"{label} on {host}", client) for host, client in sorted(clients.items())]
    if services.fleet is not None:
        found.append(("the fleet monitor", services.fleet))
    return found


async def check(service: str, client: Pingable) -> Check:
    try:
        await asyncio.wait_for(client.ping(), PING_TIMEOUT)
    except TimeoutError:
        return Check(service, f"no answer within {PING_TIMEOUT:g} s")
    except ClientError as exc:
        return Check(service, str(exc))
    return Check(service, "")


async def check_all(services: Services) -> tuple[Check, ...]:
    return tuple(await asyncio.gather(*(check(name, c) for name, c in named(services))))


HEALTH: Key[tuple[Check, ...]] = Key("service_health")


@tool(
    "service_health",
    "Whether each service behind the server answers right now: Plex, Seerr, Wizarr, and "
    "Sonarr, Radarr, SABnzbd and Tautulli on every host. Lists what is up and what is down, "
    "and why. Use it for 'is Plex down?' or when another tool says a service didn't answer. "
    "Checked at most once a minute; `checked` says how long ago.",
    {"type": "object", "properties": {}, "additionalProperties": False},
    tier=Tier.FRIEND,
)
async def service_health(ctx: ToolContext) -> dict[str, Any]:
    kept = await ctx.memo.fresh(HEALTH, HEALTH_TTL, lambda: check_all(ctx.services))
    checks = kept.value
    down = [{"service": c.service, "why": c.down} for c in checks if c.down]
    return {
        "all_up": not down,
        "up": [c.service for c in checks if not c.down],
        "down": down,
        "checked": ago(ctx.memo.age(kept)),
    }
