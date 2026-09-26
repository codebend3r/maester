from __future__ import annotations

from typing import Any

import httpx

DEFAULT_TIMEOUT = 15.0


class ClientError(RuntimeError):
    """An HTTP or decoding failure, with enough context to log and explain."""

    def __init__(self, service: str, method: str, path: str, status: int | None, detail: str):
        self.service, self.method, self.path, self.status = service, method, path, status
        super().__init__(f"{service} {method} {path} failed ({status}): {detail}")


class HttpClient:
    """Base for the real clients: a base URL, fixed headers, and JSON helpers.

    Subclasses set `service` for error messages and pass their auth headers.
    The httpx client is created lazily so constructing a client in tests or at
    import time opens no connections.
    """

    service = "http"

    def __init__(
        self,
        base_url: str,
        headers: dict[str, str] | None = None,
        params: dict[str, str] | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self._headers = headers or {}
        self._params = params or {}
        self._timeout = timeout
        self._transport = transport
        self._client: httpx.AsyncClient | None = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                headers=self._headers,
                params=self._params,
                timeout=self._timeout,
                transport=self._transport,
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            response = await self.client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise ClientError(self.service, method, path, None, str(exc)) from exc
        if response.is_error:
            raise ClientError(self.service, method, path, response.status_code, response.text[:300])
        return response

    async def get_json(self, path: str, **kwargs: Any) -> Any:
        return self._decode(await self.request("GET", path, **kwargs), path)

    async def post_json(self, path: str, body: Any = None, **kwargs: Any) -> Any:
        response = await self.request("POST", path, json=body, **kwargs)
        return self._decode(response, path) if response.content else None

    async def put_json(self, path: str, body: Any = None, **kwargs: Any) -> Any:
        response = await self.request("PUT", path, json=body, **kwargs)
        return self._decode(response, path) if response.content else None

    async def delete(self, path: str, **kwargs: Any) -> None:
        await self.request("DELETE", path, **kwargs)

    def _decode(self, response: httpx.Response, path: str) -> Any:
        try:
            return response.json()
        except ValueError as exc:
            raise ClientError(self.service, "GET", path, response.status_code, "not JSON") from exc
