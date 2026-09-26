"""Named service instances, so nothing ever talks to "Sonarr" without a host.

Two NAS hosts each run their own Sonarr, Radarr, SABnzbd and Tautulli on the
same ports. Every tool that touches one takes a host name, and this registry
is the only place that turns (service, host) into a URL and key. It also maps
a media path to the host whose arr owns it, and refuses when no host matches,
because acting on the wrong stack has happened before (see wizteros
docs/arr-stack.md).

Instances are discovered from the environment as `{SERVICE}_{HOST}_URL` plus
`{SERVICE}_{HOST}_API_KEY`, so adding a third host is two variables, not code.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

PER_HOST_SERVICES = ("sonarr", "radarr", "sabnzbd", "tautulli")

_URL_VAR = re.compile(r"^(?P<service>[A-Z]+)_(?P<host>[A-Z0-9]+)_URL$")


class UnknownInstance(LookupError):
    def __init__(self, service: str, host: str, known: Iterable[str]):
        self.service, self.host = service, host
        hosts = ", ".join(sorted(known)) or "none configured"
        super().__init__(f"no {service} instance on host {host!r}; known hosts: {hosts}")


class NoOwningHost(LookupError):
    def __init__(self, service: str, path: str):
        self.service, self.path = service, path
        super().__init__(f"no {service} instance has a root folder containing {path!r}")


@dataclass(frozen=True)
class Instance:
    service: str
    host: str
    url: str
    api_key: str
    # Root folders are learned from the arr API after boot, so an instance can
    # be addressed before its folders are known; owning-host lookups need them.
    root_folders: tuple[str, ...] = field(default=())

    def with_root_folders(self, folders: Iterable[str]) -> Instance:
        normalized = tuple(f.rstrip("/") + "/" for f in folders)
        return Instance(self.service, self.host, self.url, self.api_key, normalized)

    def owns(self, path: str) -> bool:
        return any(path.startswith(folder) for folder in self.root_folders)


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

    def host_for_path(self, service: str, path: str) -> Instance:
        """The instance whose root folders contain `path`, or NoOwningHost.

        Never guesses: with two stacks mounting the same shares, a path that
        matches nobody's root folders is a path nobody should act on.
        """
        owners = [i for i in self.instances(service.lower()) if i.owns(path)]
        if len(owners) != 1:
            raise NoOwningHost(service, path)
        return owners[0]

    def missing_keys(self) -> list[str]:
        """Instances configured with a URL but no API key, as env variable names."""
        return [
            f"{i.service.upper()}_{i.host.upper()}_API_KEY"
            for i in self.instances()
            if not i.api_key
        ]
