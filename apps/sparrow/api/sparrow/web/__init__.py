"""The FastAPI side: sparrow's own API, webhooks from Seerr (and Tautulli, later), and /health."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from sparrow import __version__
from sparrow.web.api import Api
from sparrow.web.auth import Refused
from sparrow.web.chat import ChatApi
from sparrow.web.seerr import SeerrWebhook


def create_app(
    *, seerr: SeerrWebhook | None = None, api: Api | None = None, chat: ChatApi | None = None
) -> FastAPI:
    """Build the app; with none of `seerr`, `api` and `chat`, only /health is served (the CI
    smoke test)."""
    app = FastAPI(title="sparrow", version=__version__, docs_url=None, redoc_url=None)

    @app.exception_handler(Refused)
    async def refused(request: Request, exc: Refused) -> JSONResponse:
        return JSONResponse(exc.body, status_code=exc.status)

    @app.middleware("http")
    async def no_store(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/health")
    async def health() -> dict[str, str]:
        # The one ungated route, so the container healthcheck can probe it
        # without a session.
        return {"status": "ok", "version": __version__}

    if seerr is not None:
        app.include_router(seerr.router())
    if api is not None:
        app.include_router(api.router())
    if chat is not None:
        app.include_router(chat.router())
    return app
