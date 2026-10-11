"""The FastAPI side: luwin's own API, webhooks from Seerr (and Tautulli, later), and /health."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from luwin import __version__
from luwin.web.api import Api
from luwin.web.auth import Refused
from luwin.web.seerr import SeerrWebhook


def create_app(*, seerr: SeerrWebhook | None = None, api: Api | None = None) -> FastAPI:
    """Build the app; with neither `seerr` nor `api`, only /health is served (the CI smoke
    test)."""
    app = FastAPI(title="luwin", version=__version__, docs_url=None, redoc_url=None)

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
    return app
