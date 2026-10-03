"""Running a program luwin ships with, without a shell and never for longer than asked.

ffprobe and ffmpeg (`media.py`) and the speed test (`speedtest.py`) run this
way: an argv list, no shell, stdin closed, output captured. A run that
outlasts its timeout, or whose asker is cancelled, is killed and reaped. The
runner is injected wherever it's used, so tests never start a process.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class Completed:
    exit_code: int | None  # None when it ran out of time and was killed
    stdout: str
    stderr: str


Runner = Callable[[Sequence[str], float], Awaitable[Completed]]


async def run_process(argv: Sequence[str], timeout: float) -> Completed:
    """Run a program without a shell; kill it when it outlasts `timeout` seconds."""
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError:
        return Completed(None, "", "")
    finally:  # timed out, or the task asking was cancelled: don't leave it running
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
    return Completed(proc.returncode, out.decode(errors="replace"), err.decode(errors="replace"))


def lines(text: str) -> tuple[str, ...]:
    """The non-blank lines of a program's output, stripped."""
    return tuple(line.strip() for line in text.splitlines() if line.strip())
