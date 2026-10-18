"""An httpx transport that sends each request through `curl`, for the sandbox on a Mac.

macOS's Local Network privacy keeps an unsigned interpreter (the project's Python) off the LAN
unless the app that started it was allowed on, while Apple's own `curl` always gets through. So
the sandbox reaches a raven on the LAN through this transport; the deployed server, in a
container, uses httpx's own.
"""

from __future__ import annotations

import asyncio
from asyncio.subprocess import PIPE

import httpx

CURL = "/usr/bin/curl"
# Written after the body, so the status and content type can be split off its end.
TRAILER = "\n--luwin-curl--%{http_code} %{content_type}"
MARKER = b"\n--luwin-curl--"


class CurlTransport(httpx.AsyncBaseTransport):
    def __init__(self, *, binary: str = CURL, timeout: float = 15.0):
        self.binary = binary
        self.timeout = timeout

    def command(self, request: httpx.Request) -> list[str]:
        # curl sets these itself, and `--compressed` both asks for compression and undoes it.
        headers = [
            f"{k}: {v}"
            for k, v in request.headers.items()
            if k.lower() not in ("host", "accept-encoding")
        ]
        return [
            self.binary,
            "--silent",
            "--show-error",
            "--compressed",
            "--max-time",
            f"{self.timeout:g}",
            "--request",
            request.method,
            *[arg for h in headers for arg in ("--header", h)],
            *(["--data-binary", "@-"] if request.content else []),
            "--write-out",
            TRAILER,
            str(request.url),
        ]

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        process = await asyncio.create_subprocess_exec(
            *self.command(request), stdin=PIPE, stdout=PIPE, stderr=PIPE
        )
        out, err = await process.communicate(request.content or None)
        body, found, trailer = out.rpartition(MARKER)
        status, _, content_type = trailer.decode(errors="replace").partition(" ")
        if process.returncode != 0 or not found or status == "000":
            raise httpx.ConnectError(
                err.decode(errors="replace").strip() or "curl failed", request=request
            )
        headers = {"content-type": content_type} if content_type else {}
        return httpx.Response(int(status), headers=headers, content=body, request=request)
