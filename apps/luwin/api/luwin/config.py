"""The environment luwin runs on, read once and shared.

Every module that needs a URL, a token or a limit imports it from here instead
of reading os.environ itself, so the web app, the scheduled jobs and the tools
cannot disagree about what the deployment is configured as. Reads are lenient
(missing values become empty or default) and the entrypoint calls `require()`
for what it cannot run without, so a misconfigured container dies on boot
naming everything that is missing at once, while tests and scripts can still
import any module.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import time, timedelta
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import load_dotenv


def load_env_file(path: str | Path = ".env") -> bool:
    """Read a `.env` in the working directory into os.environ, for `uv run` outside Docker.

    Compose feeds the container the same file through `env_file`, so on the NAS
    there is nothing to read; wherever there is, what the process already has
    wins over the file. Returns whether a file was read.
    """
    return load_dotenv(Path(path), override=False)


class MissingConfig(KeyError):
    """Raised by `require()` naming every variable the environment lacks."""

    def __init__(self, names: list[str]):
        self.names = names
        super().__init__(f"missing required environment: {', '.join(names)}")


def require(env: Mapping[str, str], *names: str) -> None:
    missing = [name for name in names if not env.get(name)]
    if missing:
        raise MissingConfig(missing)


# Renamed when the assistant became luwin. A leftover old name would be read by
# nothing, so the model, effort or database would quietly fall back to the
# defaults; boot refuses it instead, naming the new one.
RENAMED = {
    "MAESTER_MODEL": "LUWIN_MODEL",
    "MAESTER_EFFORT": "LUWIN_EFFORT",
    "MAESTER_DB_PATH": "LUWIN_DB_PATH",
}


class RenamedConfig(KeyError):
    """Raised by `refuse_renamed()` naming every old variable still set, and its new name."""

    def __init__(self, names: list[str]):
        self.names = names
        renames = ", ".join(f"{name} is now {RENAMED[name]}" for name in names)
        super().__init__(f"renamed environment variables: {renames}")


def refuse_renamed(env: Mapping[str, str]) -> None:
    leftover = [name for name in RENAMED if name in env]
    if leftover:
        raise RenamedConfig(leftover)


def _int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, "")
    return int(raw) if raw.strip() else default


def _url(env: Mapping[str, str], name: str) -> str:
    return env.get(name, "").strip().rstrip("/")


def _list(env: Mapping[str, str], name: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in env.get(name, "").split(",") if item.strip())


def media_root_problem(root: str) -> str | None:
    """Why a path can't be a media root: it must be absolute, and not the whole filesystem."""
    if not root.startswith("/"):
        return f"{root!r} isn't an absolute path"
    if root.rstrip("/") == "":
        return "'/' would open the whole filesystem"
    return None


def _media_roots(env: Mapping[str, str]) -> tuple[str, ...]:
    roots = _list(env, "MEDIA_ROOTS")
    if problems := [p for p in map(media_root_problem, roots) if p]:
        raise ValueError(f"MEDIA_ROOTS: {'; '.join(problems)}")
    return roots


def _pairs(env: Mapping[str, str], name: str) -> tuple[tuple[str, str], ...]:
    """`from=to,from=to`; an entry without both sides is skipped."""
    pairs = (item.split("=", 1) for item in _list(env, name) if "=" in item)
    return tuple((a.strip(), b.strip()) for a, b in pairs if a.strip() and b.strip())


WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _zone(env: Mapping[str, str]) -> str:
    """The server's time zone (`TZ`, an IANA name), checked so a typo fails on boot."""
    name = env.get("TZ", "").strip() or "UTC"
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"TZ: {name!r} isn't a known time zone (try 'America/Toronto')") from None
    return name


def _clock(env: Mapping[str, str], name: str, default: time) -> time:
    """A time of day as `HH:MM`."""
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        return time.fromisoformat(raw)
    except ValueError:
        raise ValueError(f"{name}: {raw!r} isn't a time of day like 08:00") from None


def _weekday(env: Mapping[str, str], name: str, default: int) -> int:
    """A day of the week by name ("mon", "Monday"), as 0 for Monday through 6."""
    raw = env.get(name, "").strip().lower()[:3]
    if not raw:
        return default
    if raw not in WEEKDAYS:
        raise ValueError(f"{name}: {env[name]!r} isn't a day of the week")
    return WEEKDAYS.index(raw)


@dataclass(frozen=True)
class Jobs:
    """When the admin console's scheduled jobs run, in the server's time zone."""

    timezone: str = "UTC"
    # The daily digest, and the weekly NAS health report on `nas_report_day` at the same time.
    digest_at: time = time(8, 0)
    nas_report_day: int = 0  # Monday
    # How often the stalled-download sweeper looks, and how long a download may be
    # stuck before it's blocklisted and searched again.
    sweep_every: timedelta = timedelta(minutes=15)
    stalled_after: timedelta = timedelta(hours=6)

    @property
    def zone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


EXPIRY_REMINDER = "Heads up: your Plex access ends {when} ({date}). {renew}"


def _pattern(env: Mapping[str, str], name: str, default: str) -> str:
    raw = env.get(name, "").strip() or default
    try:
        re.compile(raw)
    except re.error as exc:
        raise ValueError(f"{name}: {raw!r} isn't a regular expression ({exc})") from None
    return raw


def _days(env: Mapping[str, str], name: str, default: tuple[int, ...]) -> tuple[int, ...]:
    """Whole days, "7,1"; most first."""
    raw = _list(env, name)
    if not raw:
        return default
    if not all(d.isdigit() for d in raw):
        raise ValueError(f"{name}: {env[name]!r} isn't a list of days like 7,1")
    return tuple(sorted({int(d) for d in raw}, reverse=True))


def _reminder(env: Mapping[str, str]) -> str:
    """The expiry reminder's text, checked so a typo in a placeholder fails on boot."""
    text = env.get("EXPIRY_REMINDER", "").strip() or EXPIRY_REMINDER
    try:
        text.format(when="in 7 days", date="Sat Oct 04", renew="")
    except (KeyError, IndexError, ValueError) as exc:
        raise ValueError(
            f"EXPIRY_REMINDER: only {{when}}, {{date}} and {{renew}} can be filled in ({exc!r})"
        ) from None
    return text


@dataclass(frozen=True)
class Access:
    """How invites and access changes are scoped, and how friends hear their access is ending."""

    invite_expires_days: int = 7  # how long an invite link works
    # Where friends open an invite link (`<this>/j/<code>`): Wizarr's public address.
    public_url: str = ""
    # Wizarr server names an invite shares from; empty for every server.
    servers: tuple[str, ...] = ()
    access_days: int = 35  # how long access lasts once joined; 0 for no end
    # Library names an invite shares; empty for every library that isn't 4K or private.
    libraries: tuple[str, ...] = ()
    # Library names never shared, whatever is asked (wizteros' "9X." libraries).
    private_pattern: str = r"^9\d\."
    # Where a friend keeps their access going, named in the expiry reminder.
    contribution_url: str = ""
    # The reminder DM: {when} ("in 7 days", "tomorrow", "today"), {date}, and {renew}.
    reminder: str = EXPIRY_REMINDER
    # How many days before access ends a reminder goes out, each once.
    remind_days: tuple[int, ...] = (7, 1)

    def is_private(self, library: str) -> bool:
        return re.search(self.private_pattern, library) is not None


@dataclass(frozen=True)
class FleetMonitorAccess:
    """Where the fleet monitor is, and the bearer token for its CPU and memory routes."""

    url: str
    token: str


def _fleet_monitor(env: Mapping[str, str]) -> FleetMonitorAccess | None:
    """The fleet monitor, when FLEET_MONITOR_URL is set; its token must be set with it."""
    url = _url(env, "FLEET_MONITOR_URL")
    if not url:
        return None
    require(env, "FLEET_MONITOR_TOKEN")
    return FleetMonitorAccess(url, env["FLEET_MONITOR_TOKEN"].strip())


@dataclass(frozen=True)
class Guardrails:
    replace_daily_cap: int = 3
    storage_pause_4k_percent: int = 90
    user_messages_per_hour: int = 30
    user_tokens_per_day: int = 200_000


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str = ""
    model: str = "claude-opus-5-5"
    effort: str = "medium"  # low | medium | high | xhigh | max

    seerr_url: str = ""
    seerr_api_key: str = ""
    seerr_webhook_secret: str = ""
    plex_url: str = ""
    plex_token: str = ""
    wizarr_url: str = ""
    wizarr_api_key: str = ""
    # plex.tv, where friends' library shares live; the account is `PLEX_TOKEN`'s.
    plex_tv_url: str = "https://plex.tv"
    # rookery, which owns sign-in: its LAN address, which luwin asks who a session
    # belongs to with the service token; and the public address browsers sign in at.
    rookery_url: str = ""
    rookery_public_url: str = ""
    rookery_service_token: str = ""
    access: Access = field(default_factory=Access)
    # A friend who wants an English dub gets this Sonarr/Radarr tag on the
    # request, and the quality profile named here when it exists.
    dub_tag: str = "dub"
    dub_profile: str = ""
    # The file health check reads media only under these read-only mounts. An
    # arr path that starts with a mapped prefix is read under its mount instead.
    media_roots: tuple[str, ...] = ()
    media_path_map: tuple[tuple[str, str], ...] = ()
    probe_timeout_seconds: int = 120
    # CPU and memory per NAS, for server load; None when no monitor is set up.
    fleet_monitor: FleetMonitorAccess | None = None
    # The host luwin's container runs on, where the speed test runs; empty for none.
    speedtest_host: str = ""
    # Files reported from one release group in 30 days before the digest suggests blocking it.
    bad_release_reports: int = 3
    jobs: Jobs = field(default_factory=Jobs)

    guardrails: Guardrails = field(default_factory=Guardrails)
    db_path: str = "/data/luwin.db"
    web_port: int = 8020


# What luwin cannot start without. Per-host arr instances are discovered by
# the registry and validated there, so they are not listed here.
REQUIRED = (
    "ANTHROPIC_API_KEY",
    "SEERR_URL",
    "SEERR_API_KEY",
    "ROOKERY_URL",
    "ROOKERY_PUBLIC_URL",
    "ROOKERY_SERVICE_TOKEN",
)


def load_settings(env: Mapping[str, str]) -> Settings:
    return Settings(
        anthropic_api_key=env.get("ANTHROPIC_API_KEY", ""),
        model=env.get("LUWIN_MODEL", "").strip() or "claude-opus-5-5",
        effort=env.get("LUWIN_EFFORT", "").strip() or "medium",
        seerr_url=_url(env, "SEERR_URL"),
        seerr_api_key=env.get("SEERR_API_KEY", ""),
        seerr_webhook_secret=env.get("SEERR_WEBHOOK_SECRET", ""),
        plex_url=_url(env, "PLEX_URL"),
        plex_token=env.get("PLEX_TOKEN", ""),
        wizarr_url=_url(env, "WIZARR_URL"),
        wizarr_api_key=env.get("WIZARR_API_KEY", ""),
        plex_tv_url=_url(env, "PLEX_TV_URL") or "https://plex.tv",
        rookery_url=_url(env, "ROOKERY_URL"),
        rookery_public_url=_url(env, "ROOKERY_PUBLIC_URL"),
        rookery_service_token=env.get("ROOKERY_SERVICE_TOKEN", "").strip(),
        access=Access(
            invite_expires_days=_int(env, "INVITE_EXPIRES_DAYS", 7),
            public_url=_url(env, "WIZARR_PUBLIC_URL"),
            servers=_list(env, "INVITE_SERVERS"),
            access_days=_int(env, "INVITE_ACCESS_DAYS", 35),
            libraries=_list(env, "INVITE_LIBRARIES"),
            private_pattern=_pattern(env, "PRIVATE_LIBRARIES", r"^9\d\."),
            contribution_url=_url(env, "CONTRIBUTION_URL"),
            reminder=_reminder(env),
            remind_days=_days(env, "EXPIRY_REMIND_DAYS", (7, 1)),
        ),
        dub_tag=env.get("DUB_TAG", "").strip() or "dub",
        dub_profile=env.get("DUB_PROFILE", "").strip(),
        media_roots=_media_roots(env),
        media_path_map=_pairs(env, "MEDIA_PATH_MAP"),
        probe_timeout_seconds=_int(env, "PROBE_TIMEOUT_SECONDS", 120),
        fleet_monitor=_fleet_monitor(env),
        speedtest_host=env.get("SPEEDTEST_HOST", "").strip().lower(),
        bad_release_reports=_int(env, "BAD_RELEASE_REPORTS", 3),
        jobs=Jobs(
            timezone=_zone(env),
            digest_at=_clock(env, "DIGEST_TIME", time(8, 0)),
            nas_report_day=_weekday(env, "NAS_REPORT_DAY", 0),
            sweep_every=timedelta(minutes=_int(env, "SWEEP_MINUTES", 15)),
            stalled_after=timedelta(hours=_int(env, "STALLED_HOURS", 6)),
        ),
        guardrails=Guardrails(
            replace_daily_cap=_int(env, "REPLACE_DAILY_CAP", 3),
            storage_pause_4k_percent=_int(env, "STORAGE_PAUSE_4K_PERCENT", 90),
            user_messages_per_hour=_int(env, "USER_MESSAGES_PER_HOUR", 30),
            user_tokens_per_day=_int(env, "USER_TOKENS_PER_DAY", 200_000),
        ),
        db_path=env.get("LUWIN_DB_PATH", "").strip() or "/data/luwin.db",
        web_port=_int(env, "WEB_PORT", 8020),
    )


@lru_cache(maxsize=1)
def settings() -> Settings:
    """The process-wide settings, read from os.environ on first use."""
    return load_settings(os.environ)
