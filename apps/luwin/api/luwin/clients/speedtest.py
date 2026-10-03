"""A speed test of the internet connection, run by Ookla's speedtest CLI in this container.

luwin runs in one container on one NAS and has no shell or SSH, so the
test runs here, where it can be done honestly: the Dockerfile pins the CLI
(version and checksum), and it runs like ffprobe does (`process.py`): no
shell, a fixed argv, under a timeout. Its machine-readable output gives
speeds in bytes per second, which are read here in kbps like every other
bitrate in luwin. `host` is the NAS
the container runs on (`SPEEDTEST_HOST`); rationing the tests is the
tool's job (`luwin/perf/uplink.py`).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol

from luwin.clients.process import Runner, lines, run_process

# Ookla's CLI asks to accept its license and the GDPR notice on first run; a
# service can't answer a prompt, so they're accepted on the command line.
ARGV = ("speedtest", "--accept-license", "--accept-gdpr", "--format=json")
# A test takes about 20 s; one still going after this is stuck.
TIMEOUT = 90.0


class SpeedTestFailed(Exception):
    """The speed test didn't give a result; the message says why."""


def _kbps(bytes_per_second: Any) -> int:
    return round(float(bytes_per_second) * 8 / 1000)


@dataclass(frozen=True)
class SpeedResult:
    upload_kbps: int
    download_kbps: int
    ping_ms: float
    server: str  # the test server: "Rogers, Toronto, ON"
    isp: str
    url: str  # the result on speedtest.net

    @classmethod
    def from_ookla(cls, raw: dict[str, Any]) -> SpeedResult:
        server = raw.get("server") or {}
        return cls(
            upload_kbps=_kbps(raw["upload"]["bandwidth"]),
            download_kbps=_kbps(raw["download"]["bandwidth"]),
            ping_ms=round(float((raw.get("ping") or {}).get("latency") or 0), 1),
            server=", ".join(p for p in (server.get("name"), server.get("location")) if p),
            isp=raw.get("isp") or "",
            url=(raw.get("result") or {}).get("url") or "",
        )


class SpeedTester(Protocol):
    host: str

    async def measure(self) -> SpeedResult: ...


def _json_lines(text: str) -> list[dict[str, Any]]:
    found = []
    for line in lines(text):
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            found.append(value)
    return found


class OoklaSpeedTest:
    def __init__(self, host: str, run: Runner = run_process, *, timeout: float = TIMEOUT):
        self.host = host
        self.timeout = timeout
        self._run = run

    async def measure(self) -> SpeedResult:
        try:
            done = await self._run(ARGV, self.timeout)
        except OSError as exc:  # not installed, or not executable
            raise SpeedTestFailed(f"the speedtest CLI couldn't start ({exc})") from exc
        if done.exit_code is None:
            raise SpeedTestFailed(f"it took longer than {self.timeout:.0f} s")
        said = _json_lines(done.stdout) + _json_lines(done.stderr)
        result = next((r for r in said if r.get("type") == "result"), None)
        if result is not None and done.exit_code == 0:
            try:
                return SpeedResult.from_ookla(result)
            except (KeyError, TypeError, ValueError) as exc:
                raise SpeedTestFailed(f"its result was missing {exc}") from exc
        logged = [r["message"] for r in said if r.get("type") == "log" and r.get("message")]
        why = next(iter(logged or lines(done.stderr)), f"exit code {done.exit_code}")
        raise SpeedTestFailed(why)


@dataclass
class FakeSpeedTest:
    """A speed test that answers `result`, or fails with `why` while `result` is None."""

    host: str = "meleys"
    result: SpeedResult | None = None
    why: str = "Cannot open socket: no test server answered"
    runs: int = 0

    async def measure(self) -> SpeedResult:
        self.runs += 1
        if self.result is None:
            raise SpeedTestFailed(self.why)
        return self.result
