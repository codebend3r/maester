"""Wires settings into clients, store, agent, chat service, bot and web app.

`build()` is pure construction and safe to call in tests with fake
clients; `run()` starts the Discord client and the web server on one
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

from maester.agent.limits import KillSwitch, RateLimiter
from maester.agent.loop import Agent
from maester.agent.runner import ToolRunner
from maester.agent.tools import ToolRegistry
from maester.agent.tools import registry as app_registry
from maester.chat.bot import MaesterBot
from maester.chat.identity import IdentityService, RoleMap
from maester.chat.service import ChatService
from maester.clients import (
    PlexClient,
    RadarrClient,
    SabnzbdClient,
    SeerrClient,
    SonarrClient,
    TautulliClient,
    WizarrClient,
)
from maester.config import REQUIRED, Settings, require, settings
from maester.registry import Registry
from maester.store import Store
from maester.web import create_app

# Importing the tools package registers every tool module into app_registry.
import maester.tools  # noqa: F401  isort: skip

log = logging.getLogger("maester")


@dataclass
class Services:
    seerr: Any
    plex: Any
    wizarr: Any
    sonarr: dict[str, Any]
    radarr: dict[str, Any]
    sabnzbd: dict[str, Any]
    tautulli: dict[str, Any]
    registry: Registry


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
        registry=instances,
    )


@dataclass
class App:
    settings: Settings
    store: Store
    services: Any
    agent: Agent
    chat: ChatService
    bot: MaesterBot
    web: Any
    kill_switch: KillSwitch


def build(
    cfg: Settings | None = None,
    *,
    services: Any = None,
    model_client: Any = None,
    tools: ToolRegistry | None = None,
    store: Store | None = None,
) -> App:
    cfg = cfg or settings()
    store = store or Store(cfg.db_path)
    services = services or build_services(cfg, Registry.from_env(os.environ))
    kill = KillSwitch()
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
    )
    identity = IdentityService(
        store, services, RoleMap(cfg.discord_role_admin, cfg.discord_role_trusted)
    )
    chat = ChatService(agent=agent, identity=identity, store=store)
    bot = MaesterBot(
        chat,
        guild_id=cfg.discord_guild_id,
        requests_channel_id=cfg.discord_requests_channel_id,
        admin_channel_id=cfg.discord_admin_channel_id,
    )
    chat.notify_admin = bot.notify_admin
    return App(cfg, store, services, agent, chat, bot, create_app(), kill)


async def serve(app: App) -> None:
    config = uvicorn.Config(app.web, host="0.0.0.0", port=app.settings.web_port, log_level="info")
    server = uvicorn.Server(config)
    web_task = asyncio.create_task(server.serve(), name="web")
    bot_task = asyncio.create_task(app.bot.start(app.settings.discord_bot_token), name="discord")
    done, pending = await asyncio.wait({web_task, bot_task}, return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    for task in done:
        if task.exception():
            raise task.exception()  # type: ignore[misc]


def run() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    require(os.environ, *REQUIRED)
    app = build()
    log.info("starting maester (model %s) on port %s", app.settings.model, app.settings.web_port)
    try:
        asyncio.run(serve(app))
    except KeyboardInterrupt:
        pass
    finally:
        app.store.close()
    return 0
