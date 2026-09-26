"""The environment maester runs on, read once and shared.

Every module that needs a URL, a token or a limit imports it from here instead
of reading os.environ itself, so the Discord client, the web app and the tools
cannot disagree about what the deployment is configured as. Reads are lenient
(missing values become empty or default) and the entrypoint calls `require()`
for what it cannot run without, so a misconfigured container dies on boot
naming everything that is missing at once, while tests and scripts can still
import any module.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from functools import lru_cache


class MissingConfig(KeyError):
    """Raised by `require()` naming every variable the environment lacks."""

    def __init__(self, names: list[str]):
        self.names = names
        super().__init__(f"missing required environment: {', '.join(names)}")


def require(env: Mapping[str, str], *names: str) -> None:
    missing = [name for name in names if not env.get(name)]
    if missing:
        raise MissingConfig(missing)


def _int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, "")
    return int(raw) if raw.strip() else default


def _url(env: Mapping[str, str], name: str) -> str:
    return env.get(name, "").strip().rstrip("/")


@dataclass(frozen=True)
class Guardrails:
    replace_daily_cap: int = 3
    storage_pause_4k_percent: int = 90
    user_messages_per_hour: int = 30
    user_tokens_per_day: int = 200_000


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str = ""
    model: str = "claude-opus-5"
    effort: str = "medium"  # low | medium | high | xhigh | max

    discord_bot_token: str = ""
    discord_guild_id: int = 0
    discord_requests_channel_id: int = 0
    discord_admin_channel_id: int = 0
    discord_role_trusted: int = 0
    discord_role_admin: int = 0

    seerr_url: str = ""
    seerr_api_key: str = ""
    seerr_webhook_secret: str = ""
    plex_url: str = ""
    plex_token: str = ""
    wizarr_url: str = ""
    wizarr_api_key: str = ""
    invite_expires_days: int = 7

    guardrails: Guardrails = field(default_factory=Guardrails)
    db_path: str = "/data/maester.db"
    web_port: int = 8020


# What the bot cannot start without. Per-host arr instances are discovered by
# the registry and validated there, so they are not listed here.
REQUIRED = (
    "ANTHROPIC_API_KEY",
    "DISCORD_BOT_TOKEN",
    "DISCORD_GUILD_ID",
    "SEERR_URL",
    "SEERR_API_KEY",
)


def load_settings(env: Mapping[str, str]) -> Settings:
    return Settings(
        anthropic_api_key=env.get("ANTHROPIC_API_KEY", ""),
        model=env.get("MAESTER_MODEL", "").strip() or "claude-opus-5",
        effort=env.get("MAESTER_EFFORT", "").strip() or "medium",
        discord_bot_token=env.get("DISCORD_BOT_TOKEN", ""),
        discord_guild_id=_int(env, "DISCORD_GUILD_ID", 0),
        discord_requests_channel_id=_int(env, "DISCORD_REQUESTS_CHANNEL_ID", 0),
        discord_admin_channel_id=_int(env, "DISCORD_ADMIN_CHANNEL_ID", 0),
        discord_role_trusted=_int(env, "DISCORD_ROLE_TRUSTED", 0),
        discord_role_admin=_int(env, "DISCORD_ROLE_ADMIN", 0),
        seerr_url=_url(env, "SEERR_URL"),
        seerr_api_key=env.get("SEERR_API_KEY", ""),
        seerr_webhook_secret=env.get("SEERR_WEBHOOK_SECRET", ""),
        plex_url=_url(env, "PLEX_URL"),
        plex_token=env.get("PLEX_TOKEN", ""),
        wizarr_url=_url(env, "WIZARR_URL"),
        wizarr_api_key=env.get("WIZARR_API_KEY", ""),
        invite_expires_days=_int(env, "INVITE_EXPIRES_DAYS", 7),
        guardrails=Guardrails(
            replace_daily_cap=_int(env, "REPLACE_DAILY_CAP", 3),
            storage_pause_4k_percent=_int(env, "STORAGE_PAUSE_4K_PERCENT", 90),
            user_messages_per_hour=_int(env, "USER_MESSAGES_PER_HOUR", 30),
            user_tokens_per_day=_int(env, "USER_TOKENS_PER_DAY", 200_000),
        ),
        db_path=env.get("MAESTER_DB_PATH", "").strip() or "/data/maester.db",
        web_port=_int(env, "WEB_PORT", 8020),
    )


@lru_cache(maxsize=1)
def settings() -> Settings:
    """The process-wide settings, read from os.environ on first use."""
    return load_settings(os.environ)
