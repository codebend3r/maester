"""Wires settings into clients, store, agent, chat service, admin console and web app.

`build()` is pure construction and safe to call in tests with fake
clients; `run()` starts the web server and the scheduled jobs on one
asyncio loop and returns when either stops.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Any

import anthropic
import uvicorn
from fastapi import FastAPI

from luwin.agent.limits import KillSwitch, RateLimiter
from luwin.agent.loop import Agent
from luwin.agent.runner import ToolRunner
from luwin.agent.tools import ToolRegistry
from luwin.agent.tools import registry as app_registry
from luwin.chat.admin import AdminConsole
from luwin.chat.identity import IdentityService
from luwin.chat.service import ChatService
from luwin.clients import (
    FileProbe,
    OoklaSpeedTest,
    PlexClient,
    PlexTvClient,
    RadarrClient,
    SabnzbdClient,
    SeerrClient,
    Services,
    SonarrClient,
    TautulliClient,
    WizarrClient,
)
from luwin.clients.fleet import FleetMonitorClient
from luwin.clients.media import MediaPaths
from luwin.config import REQUIRED, Settings, load_env_file, refuse_renamed, require, settings
from luwin.jobs import Scheduler, scheduled
from luwin.notify import LogNotifier
from luwin.registry import Registry
from luwin.seerr_events import seerr_routes
from luwin.store import Store
from luwin.web import create_app
from luwin.web.seerr import SeerrWebhook

# Importing the tools package registers every tool module into app_registry.
import luwin.tools  # noqa: F401  isort: skip

log = logging.getLogger("luwin")


def build_services(cfg: Settings, instances: Registry) -> Services:
    def per_host(service: str, cls: type) -> dict[str, Any]:
        return {i.host: cls(i.host, i.url, i.api_key) for i in instances.instances(service)}

    return Services(
        seerr=SeerrClient(cfg.seerr_url, cfg.seerr_api_key),
        plex=PlexClient(cfg.plex_url, cfg.plex_token),
        wizarr=WizarrClient(cfg.wizarr_url, cfg.wizarr_api_key),
        sonarr=per_host("sonarr", SonarrClient),
        radarr=per_host("radarr", RadarrClient),
        sabnzbd=per_host("sabnzbd", SabnzbdClient),
        tautulli=per_host("tautulli", TautulliClient),
        probe=FileProbe(
            MediaPaths(cfg.media_roots, cfg.media_path_map), timeout=cfg.probe_timeout_seconds
        ),
        fleet=(
            FleetMonitorClient(cfg.fleet_monitor.url, cfg.fleet_monitor.token)
            if cfg.fleet_monitor
            else None
        ),
        speedtest=OoklaSpeedTest(cfg.speedtest_host) if cfg.speedtest_host else None,
        plextv=PlexTvClient(cfg.plex_tv_url, cfg.plex_token) if cfg.plex_token else None,
    )


@dataclass
class App:
    settings: Settings
    store: Store
    services: Services
    agent: Agent
    chat: ChatService
    console: AdminConsole
    web: FastAPI
    kill_switch: KillSwitch
    scheduler: Scheduler


def build(
    cfg: Settings | None = None,
    *,
    services: Services | None = None,
    model_client: Any = None,
    tools: ToolRegistry | None = None,
    store: Store | None = None,
) -> App:
    cfg = cfg or settings()
    store = store or Store(cfg.db_path)
    services = services or build_services(cfg, Registry.from_env(os.environ))
    kill = KillSwitch(store)
    runner = ToolRunner(tools or app_registry, kill_switch=kill)
    agent = Agent(
        model_client=model_client
        or anthropic.AsyncAnthropic(api_key=cfg.anthropic_api_key or None),
        model=cfg.model,
        runner=runner,
        store=store,
        services=services,
        limiter=RateLimiter(
            cfg.guardrails.user_messages_per_hour, cfg.guardrails.user_tokens_per_day
        ),
        effort=cfg.effort,
        settings=cfg,
    )
    identity = IdentityService(store, services)
    chat = ChatService(agent=agent, identity=identity, store=store)
    console = AdminConsole(
        identity=identity,
        chat=chat,
        store=store,
        services=services,
        settings=cfg,
        kill_switch=kill,
    )
    # Until luwin's own app delivers notices, they go to the log.
    notifier = LogNotifier()
    seerr = SeerrWebhook(cfg.seerr_webhook_secret, seerr_routes(services, store), store, notifier)
    scheduler = Scheduler(scheduled(services, store, cfg, kill), store=store, notifier=notifier)
    return App(cfg, store, services, agent, chat, console, create_app(seerr=seerr), kill, scheduler)


async def serve(app: App) -> None:
    config = uvicorn.Config(app.web, host="0.0.0.0", port=app.settings.web_port, log_level="info")
    server = uvicorn.Server(config)
    web_task = asyncio.create_task(server.serve(), name="web")
    jobs_task = asyncio.create_task(run_jobs(app), name="jobs")
    done, pending = await asyncio.wait({web_task, jobs_task}, return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    for task in done:
        if not task.cancelled() and (exc := task.exception()):
            raise exc


async def run_jobs(app: App) -> None:
    """The scheduled jobs: the digest, the sweeper, the space sample and the NAS report."""
    await app.scheduler.run()


def run() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    load_env_file()
    refuse_renamed(os.environ)
    require(os.environ, *REQUIRED)
    app = build()
    log.info("starting luwin (model %s) on port %s", app.settings.model, app.settings.web_port)
    try:
        asyncio.run(serve(app))
    except KeyboardInterrupt:
        pass
    finally:
        app.store.close()
    return 0
