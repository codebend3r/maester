"""The FastAPI side: webhooks from Seerr (and Tautulli, later), and /health."""

from __future__ import annotations

from fastapi import FastAPI

from luwin import __version__
from luwin.web.seerr import SeerrWebhook


def create_app(*, seerr: SeerrWebhook | None = None) -> FastAPI:
    """Build the app; with no `seerr`, only /health is served (the CI smoke test)."""
    app = FastAPI(title="luwin", version=__version__, docs_url=None, redoc_url=None)

    @app.get("/health")
    async def health() -> dict[str, str]:
        # The one ungated route, so the container healthcheck can probe it
        # without a session.
        return {"status": "ok", "version": __version__}

    if seerr is not None:
        app.include_router(seerr.router())
    return app
