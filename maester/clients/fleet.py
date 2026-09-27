"""The fleet monitor (wizteros' `fleet-monitor`): each NAS's CPU and memory, when set up.

The monitor keeps every host's vitals as history (`/fleet/cpu`,
`/fleet/memory`, one series of points per host) and gates every route but
`/health` behind a Supabase session: `Authorization: Bearer <jwt>`, signed
ES256 by the project, audience "authenticated", whose email is on the
monitor's allowlist (`FM_ADMIN_ALLOWED_EMAILS`). maester signs in the way
the admin portal does, with Supabase Auth's password grant, as an account
of its own whose email the admin adds to that allowlist; nothing in the
monitor changes. The access token is kept until shortly before it expires,
and a 401 from the monitor (a session revoked early) signs in once more.

A host's vitals are the last point of a short window, so a host the
collector hasn't reached lately has none rather than an old number.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from maester.clients.base import ClientError, HttpClient

# The collector samples every 30 s; a reading older than this doesn't describe "now".
WINDOW_MINUTES = 5
# Seconds before its expiry that a token is replaced.
TOKEN_MARGIN = 60


@dataclass(frozen=True)
class Vitals:
    """One NAS's latest CPU and memory use, in percent; None when the window has no reading."""

    cpu_percent: float | None
    memory_percent: float | None


class FleetMonitor(Protocol):
    async def vitals(self) -> dict[str, Vitals]: ...
    async def ping(self) -> None: ...


@dataclass(frozen=True)
class SupabaseLogin:
    """The Supabase project the monitor trusts, and the account maester signs in as."""

    url: str  # the project's URL
    key: str  # its anon (publishable) key, which Supabase Auth wants on every call
    email: str
    password: str


class SupabaseSession(HttpClient):
    """A signed-in Supabase account's access token, renewed as it nears expiry.

    Callers asking at once (the CPU and memory reads) share one sign-in.
    """

    service = "supabase auth"

    def __init__(self, login: SupabaseLogin, *, clock: Callable[[], float] = time.time, **kw: Any):
        super().__init__(login.url, headers={"apikey": login.key}, **kw)
        self._login = login
        self._clock = clock
        self._token = ""
        self._expires_at = 0.0
        self._signing_in = asyncio.Lock()

    async def token(self) -> str:
        async with self._signing_in:
            if not self._token or self._clock() >= self._expires_at - TOKEN_MARGIN:
                path = "/auth/v1/token"
                answer = await self.post_json(
                    path,
                    {"email": self._login.email, "password": self._login.password},
                    params={"grant_type": "password"},
                )
                try:
                    self._token = str(answer["access_token"])
                    self._expires_at = float(answer["expires_at"])
                except (KeyError, TypeError, ValueError) as exc:
                    raise ClientError(self.service, "POST", path, 200, f"no token: {exc}") from exc
            return self._token

    def forget(self) -> None:
        """Drop the token, so the next call signs in again."""
        self._token = ""


class FleetMonitorClient(HttpClient):
    service = "fleet monitor"

    def __init__(self, base_url: str, session: SupabaseSession, **kwargs: Any):
        super().__init__(base_url, **kwargs)
        self.session = session

    async def ping(self) -> None:
        """The monitor's one open route: it answers while the API is up."""
        await self.get_json("/health")

    async def vitals(self) -> dict[str, Vitals]:
        cpu, memory = await asyncio.gather(self._latest("cpu"), self._latest("memory"))
        hosts = cpu.keys() | memory.keys()
        return {host: Vitals(cpu.get(host), memory.get(host)) for host in hosts}

    async def _latest(self, kind: str) -> dict[str, float]:
        """Each host's last reading of one metric family in the window."""
        path = f"/fleet/{kind}"
        data = await self._signed_in(path, params={"minutes": WINDOW_MINUTES})
        try:
            return {
                h["name"]: float(h["points"][-1]["value"])
                for h in data.get("hosts") or []
                if h.get("points")
            }
        except (AttributeError, KeyError, TypeError, ValueError) as exc:
            raise ClientError(self.service, "GET", path, 200, f"unexpected shape: {exc}") from exc

    async def _signed_in(self, path: str, **kwargs: Any) -> Any:
        try:
            return await self._get(path, **kwargs)
        except ClientError as exc:
            if exc.status != 401:
                raise
        self.session.forget()  # revoked before it expired: sign in once more
        return await self._get(path, **kwargs)

    async def _get(self, path: str, **kwargs: Any) -> Any:
        bearer = {"Authorization": f"Bearer {await self.session.token()}"}
        return await self.get_json(path, headers=bearer, **kwargs)


@dataclass
class FakeFleetMonitor:
    readings: dict[str, Vitals] = field(default_factory=dict)
    # While set, it answers the way an unreachable monitor would.
    down: bool = False

    async def vitals(self) -> dict[str, Vitals]:
        self._answer("/fleet/cpu")
        return dict(self.readings)

    async def ping(self) -> None:
        self._answer("/health")

    def _answer(self, path: str) -> None:
        if self.down:
            raise ClientError("fleet monitor", "GET", path, None, "connection refused")
