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
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field, fields, is_dataclass
from datetime import time, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any
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


# A setting's reader: the variable's value, or `default` when it's unset or blank. A value
# that can't be what the setting needs fails on boot, naming the variable.
Reader = Callable[[Mapping[str, str], str, Any], Any]


def _raw(env: Mapping[str, str], name: str, default: str) -> str:
    """As set, spaces and all (a key)."""
    return env.get(name, default)


def _text(env: Mapping[str, str], name: str, default: str) -> str:
    return env.get(name, "").strip() or default


def _lower(env: Mapping[str, str], name: str, default: str) -> str:
    return env.get(name, "").strip().lower() or default


def _url(env: Mapping[str, str], name: str, default: str) -> str:
    return env.get(name, "").strip().rstrip("/") or default


def _int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, "")
    return int(raw) if raw.strip() else default


def _minutes(env: Mapping[str, str], name: str, default: timedelta) -> timedelta:
    raw = env.get(name, "")
    return timedelta(minutes=int(raw)) if raw.strip() else default


def _hours(env: Mapping[str, str], name: str, default: timedelta) -> timedelta:
    raw = env.get(name, "")
    return timedelta(hours=int(raw)) if raw.strip() else default


def _list(env: Mapping[str, str], name: str, default: tuple[str, ...] = ()) -> tuple[str, ...]:
    return tuple(item.strip() for item in env.get(name, "").split(",") if item.strip()) or default


def media_root_problem(root: str) -> str | None:
    """Why a path can't be a media root: it must be absolute, and not the whole filesystem."""
    if not root.startswith("/"):
        return f"{root!r} isn't an absolute path"
    if root.rstrip("/") == "":
        return "'/' would open the whole filesystem"
    return None


def _media_roots(env: Mapping[str, str], name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    roots = _list(env, name, default)
    if problems := [p for p in map(media_root_problem, roots) if p]:
        raise ValueError(f"{name}: {'; '.join(problems)}")
    return roots


def _pairs(
    env: Mapping[str, str], name: str, default: tuple[tuple[str, str], ...]
) -> tuple[tuple[str, str], ...]:
    """`from=to,from=to`; an entry without both sides is skipped."""
    pairs = (item.split("=", 1) for item in _list(env, name) if "=" in item)
    return tuple((a.strip(), b.strip()) for a, b in pairs if a.strip() and b.strip()) or default


WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _zone(env: Mapping[str, str], name: str, default: str) -> str:
    """The server's time zone (an IANA name), checked so a typo fails on boot."""
    zone = env.get(name, "").strip() or default
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(
            f"{name}: {zone!r} isn't a known time zone (try 'America/Toronto')"
        ) from None
    return zone


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


def _reminder(env: Mapping[str, str], name: str, default: str) -> str:
    """The expiry reminder's text, checked so a typo in a placeholder fails on boot."""
    text = env.get(name, "").strip() or default
    try:
        text.format(when="in 7 days", date="Sat Oct 04", renew="")
    except (KeyError, IndexError, ValueError) as exc:
        raise ValueError(
            f"{name}: only {{when}}, {{date}} and {{renew}} can be filled in ({exc!r})"
        ) from None
    return text


@dataclass(frozen=True)
class FleetMonitorAccess:
    """Where the fleet monitor is, and the bearer token for its CPU and memory routes."""

    url: str
    token: str


def _fleet_monitor(
    env: Mapping[str, str], name: str, default: FleetMonitorAccess | None
) -> FleetMonitorAccess | None:
    """The fleet monitor, when its URL is set; FLEET_MONITOR_TOKEN must be set with it."""
    url = _url(env, name, "")
    if not url:
        return default
    require(env, "FLEET_MONITOR_TOKEN")
    return FleetMonitorAccess(url, env["FLEET_MONITOR_TOKEN"].strip())


def setting(default: Any, env: str, read: Reader = _text, *, required: bool = False) -> Any:
    """A field read from the variable `env` by `read`; `required` ones must be set to boot."""
    return field(default=default, metadata={"env": env, "read": read, "required": required})


@dataclass(frozen=True)
class Jobs:
    """When the admin console's scheduled jobs run, in the server's time zone."""

    timezone: str = setting("UTC", "TZ", _zone)
    # The daily digest, and the weekly NAS health report on `nas_report_day` at the same time.
    digest_at: time = setting(time(8, 0), "DIGEST_TIME", _clock)
    nas_report_day: int = setting(0, "NAS_REPORT_DAY", _weekday)  # Monday
    # How often the stalled-download sweeper looks, and how long a download may be
    # stuck before it's blocklisted and searched again.
    sweep_every: timedelta = setting(timedelta(minutes=15), "SWEEP_MINUTES", _minutes)
    stalled_after: timedelta = setting(timedelta(hours=6), "STALLED_HOURS", _hours)

    @property
    def zone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


EXPIRY_REMINDER = "Heads up: your Plex access ends {when} ({date}). {renew}"


@dataclass(frozen=True)
class Access:
    """How invites and access changes are scoped, and how friends hear their access is ending."""

    # How long an invite link works.
    invite_expires_days: int = setting(7, "INVITE_EXPIRES_DAYS", _int)
    # Where friends open an invite link (`<this>/j/<code>`): Wizarr's public address.
    public_url: str = setting("", "WIZARR_PUBLIC_URL", _url)
    # Wizarr server names an invite shares from; empty for every server.
    servers: tuple[str, ...] = setting((), "INVITE_SERVERS", _list)
    # How long access lasts once joined; 0 for no end.
    access_days: int = setting(35, "INVITE_ACCESS_DAYS", _int)
    # Library names an invite shares; empty for every library that isn't 4K or private.
    libraries: tuple[str, ...] = setting((), "INVITE_LIBRARIES", _list)
    # Library names never shared, whatever is asked (wizteros' "9X." libraries).
    private_pattern: str = setting(r"^9\d\.", "PRIVATE_LIBRARIES", _pattern)
    # Where a friend keeps their access going, named in the expiry reminder.
    contribution_url: str = setting("", "CONTRIBUTION_URL", _url)
    # The reminder DM: {when} ("in 7 days", "tomorrow", "today"), {date}, and {renew}.
    reminder: str = setting(EXPIRY_REMINDER, "EXPIRY_REMINDER", _reminder)
    # How many days before access ends a reminder goes out, each once.
    remind_days: tuple[int, ...] = setting((7, 1), "EXPIRY_REMIND_DAYS", _days)

    def is_private(self, library: str) -> bool:
        return re.search(self.private_pattern, library) is not None


@dataclass(frozen=True)
class Guardrails:
    replace_daily_cap: int = setting(3, "REPLACE_DAILY_CAP", _int)
    storage_pause_4k_percent: int = setting(90, "STORAGE_PAUSE_4K_PERCENT", _int)
    user_messages_per_hour: int = setting(30, "USER_MESSAGES_PER_HOUR", _int)
    user_tokens_per_day: int = setting(200_000, "USER_TOKENS_PER_DAY", _int)


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str = setting("", "ANTHROPIC_API_KEY", _raw, required=True)
    model: str = setting("claude-sonnet-5-5", "LUWIN_MODEL")
    effort: str = setting("medium", "LUWIN_EFFORT")  # low | medium | high | xhigh | max

    seerr_url: str = setting("", "SEERR_URL", _url, required=True)
    seerr_api_key: str = setting("", "SEERR_API_KEY", _raw, required=True)
    seerr_webhook_secret: str = setting("", "SEERR_WEBHOOK_SECRET", _raw)
    plex_url: str = setting("", "PLEX_URL", _url)
    plex_token: str = setting("", "PLEX_TOKEN", _raw)
    wizarr_url: str = setting("", "WIZARR_URL", _url)
    wizarr_api_key: str = setting("", "WIZARR_API_KEY", _raw)
    # plex.tv, where friends' library shares live; the account is `PLEX_TOKEN`'s.
    plex_tv_url: str = setting("https://plex.tv", "PLEX_TV_URL", _url)
    # raven, the suite's own library: searched for what is on the server, and the address
    # its links open, so it must be one friends' browsers reach too. Empty for none.
    raven_url: str = setting("", "RAVEN_URL", _url)
    # rookery, which owns sign-in: its LAN address, which luwin asks who a session
    # belongs to with the service token; and the public address browsers sign in at.
    rookery_url: str = setting("", "ROOKERY_URL", _url, required=True)
    rookery_public_url: str = setting("", "ROOKERY_PUBLIC_URL", _url, required=True)
    rookery_service_token: str = setting("", "ROOKERY_SERVICE_TOKEN", required=True)
    access: Access = field(default_factory=Access)
    # A friend who wants an English dub gets this Sonarr/Radarr tag on the
    # request, and the quality profile named here when it exists.
    dub_tag: str = setting("dub", "DUB_TAG")
    dub_profile: str = setting("", "DUB_PROFILE")
    # The file health check reads media only under these read-only mounts. An
    # arr path that starts with a mapped prefix is read under its mount instead.
    media_roots: tuple[str, ...] = setting((), "MEDIA_ROOTS", _media_roots)
    media_path_map: tuple[tuple[str, str], ...] = setting((), "MEDIA_PATH_MAP", _pairs)
    probe_timeout_seconds: int = setting(120, "PROBE_TIMEOUT_SECONDS", _int)
    # CPU and memory per NAS, for server load; None when no monitor is set up.
    fleet_monitor: FleetMonitorAccess | None = setting(None, "FLEET_MONITOR_URL", _fleet_monitor)
    # The host luwin's container runs on, where the speed test runs; empty for none.
    speedtest_host: str = setting("", "SPEEDTEST_HOST", _lower)
    # Files reported from one release group in 30 days before the digest suggests blocking it.
    bad_release_reports: int = setting(3, "BAD_RELEASE_REPORTS", _int)
    jobs: Jobs = field(default_factory=Jobs)

    guardrails: Guardrails = field(default_factory=Guardrails)
    db_path: str = setting("/data/luwin.db", "LUWIN_DB_PATH")
    web_port: int = setting(8020, "WEB_PORT", _int)


def _read[T](cls: type[T], env: Mapping[str, str]) -> T:
    """`cls` from `env`: each setting by its reader, each section (a dataclass) in turn."""
    values: dict[str, Any] = {}
    for f in fields(cls):
        if name := f.metadata.get("env"):
            values[f.name] = f.metadata["read"](env, name, f.default)
        elif is_dataclass(f.default_factory):
            values[f.name] = _read(f.default_factory, env)
    return cls(**values)


def _required(cls: type) -> Iterator[str]:
    for f in fields(cls):
        if f.metadata.get("required"):
            yield f.metadata["env"]
        elif is_dataclass(f.default_factory):
            yield from _required(f.default_factory)


# What luwin cannot start without, besides the API key of each per-host arr instance
# configured (`luwin/registry.py`).
REQUIRED = tuple(_required(Settings))


def load_settings(env: Mapping[str, str]) -> Settings:
    return _read(Settings, env)


@lru_cache(maxsize=1)
def settings() -> Settings:
    """The process-wide settings, read from os.environ on first use."""
    return load_settings(os.environ)
