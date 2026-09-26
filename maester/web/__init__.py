"""The FastAPI side: webhooks from Seerr and Tautulli, and /health."""

from __future__ import annotations

from fastapi import FastAPI

from maester import __version__


def create_app() -> FastAPI:
    app = FastAPI(title="maester", version=__version__, docs_url=None, redoc_url=None)

    @app.get("/health")
    async def health() -> dict[str, str]:
        # The one ungated route, so the container healthcheck can probe it
        # without a session or a Discord connection.
        return {"status": "ok", "version": __version__}

    return app
