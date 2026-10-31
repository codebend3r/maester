"""Named service instances, so nothing ever talks to "Sonarr" without a host.

Two NAS hosts each run their own Sonarr, Radarr, Lidarr, SABnzbd and Tautulli on the
same ports. Every tool that touches one takes a host name, and this registry
is the only place that turns (service, host) into a URL and key. Which host
owns a title is `sparrow/library.py`'s question, answered through Seerr and
never guessed, because acting on the wrong stack has happened before (see
wizteros docs/arr-stack.md).

Instances are discovered from the environment as `{SERVICE}_{HOST}_URL` plus
`{SERVICE}_{HOST}_API_KEY`, so adding a third host is two variables, not code.
"""

from __future__ import annotations

import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass

PER_HOST_SERVICES = ("sonarr", "radarr", "lidarr", "sabnzbd", "tautulli")

_URL_VAR = re.compile(r"^(?P<service>[A-Z]+)_(?P<host>[A-Z0-9]+)_URL$")


@dataclass(frozen=True)
class Instance:
    service: str
    host: str
    url: str
    api_key: str


def _configured(env: Mapping[str, str]) -> Iterator[tuple[re.Match[str], str]]:
    """Each per-host instance's URL variable that is set, and the API key variable it needs."""
    for name, value in sorted(env.items()):
        match = _URL_VAR.match(name)
        if match and value.strip() and match["service"].lower() in PER_HOST_SERVICES:
            yield match, f"{match['service']}_{match['host']}_API_KEY"


def instances_from_env(env: Mapping[str, str]) -> list[Instance]:
    """Every per-host instance the environment configures, by service and host."""
    instances = [
        Instance(
            match["service"].lower(),
            match["host"].lower(),
            env[match.string].strip().rstrip("/"),
            env.get(key, ""),
        )
        for match, key in _configured(env)
    ]
    return sorted(instances, key=lambda i: (i.service, i.host))


def api_keys_needed(env: Mapping[str, str]) -> list[str]:
    """The API key variable of every instance configured with a URL, for `require()` on boot."""
    return [key for _, key in _configured(env)]
