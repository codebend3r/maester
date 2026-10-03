"""Named service instances, so nothing ever talks to "Sonarr" without a host.

Two NAS hosts each run their own Sonarr, Radarr, SABnzbd and Tautulli on the
same ports. Every tool that touches one takes a host name, and this registry
is the only place that turns (service, host) into a URL and key. Which host
owns a title is `maester/library.py`'s question, answered through Seerr and
never guessed, because acting on the wrong stack has happened before (see
wizteros docs/arr-stack.md).

Instances are discovered from the environment as `{SERVICE}_{HOST}_URL` plus
`{SERVICE}_{HOST}_API_KEY`, so adding a third host is two variables, not code.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

PER_HOST_SERVICES = ("sonarr", "radarr", "sabnzbd", "tautulli")

_URL_VAR = re.compile(r"^(?P<service>[A-Z]+)_(?P<host>[A-Z0-9]+)_URL$")


class UnknownInstance(LookupError):
    def __init__(self, service: str, host: str, known: Iterable[str]):
        self.service, self.host = service, host
        hosts = ", ".join(sorted(known)) or "none configured"
        super().__init__(f"no {service} instance on host {host!r}; known hosts: {hosts}")


@dataclass(frozen=True)
class Instance:
    service: str
    host: str
    url: str
    api_key: str


class Registry:
    def __init__(self, instances: Iterable[Instance] = ()):
        self._by_key: dict[tuple[str, str], Instance] = {}
        for inst in instances:
            self._by_key[(inst.service, inst.host)] = inst

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Registry:
        instances = []
        for name, value in env.items():
            match = _URL_VAR.match(name)
            if not match or not value.strip():
                continue
            service = match["service"].lower()
            host = match["host"].lower()
            if service not in PER_HOST_SERVICES:
                continue
            key = env.get(f"{match['service']}_{match['host']}_API_KEY", "")
            instances.append(Instance(service, host, value.strip().rstrip("/"), key))
        return cls(instances)

    def get(self, service: str, host: str) -> Instance:
        try:
            return self._by_key[(service.lower(), host.lower())]
        except KeyError:
            raise UnknownInstance(service, host, self.hosts(service)) from None

    def hosts(self, service: str | None = None) -> list[str]:
        return sorted({h for (s, h) in self._by_key if service is None or s == service.lower()})

    def instances(self, service: str | None = None) -> list[Instance]:
        return [i for (s, _), i in sorted(self._by_key.items()) if service is None or s == service]

    def update(self, instance: Instance) -> None:
        self._by_key[(instance.service, instance.host)] = instance

    def missing_keys(self) -> list[str]:
        """Instances configured with a URL but no API key, as env variable names."""
        return [
            f"{i.service.upper()}_{i.host.upper()}_API_KEY"
            for i in self.instances()
            if not i.api_key
        ]
