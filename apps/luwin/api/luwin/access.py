"""Which libraries a friend may be given: names resolved against what's shared, private never.

A library is named with or without its "NN. " ordering prefix, ignoring case
("Anime" is "07. Anime"). A 4K library has "4K" in its name. A private one
(`PRIVATE_LIBRARIES`, wizteros' "9X." libraries) is never shared, whatever is
asked. An invite shares, from the servers `INVITE_SERVERS` names (every one
when it names none), the libraries `INVITE_LIBRARIES` names, or when it
names none, every enabled library there that isn't 4K or private.
"""

from __future__ import annotations

import re

from luwin.clients.wizarr import Library
from luwin.config import Access

_PREFIX = re.compile(r"^\d+\.\s*")


def title_of(name: str) -> str:
    """A library's name without its "NN. " ordering prefix."""
    return _PREFIX.sub("", name).strip()


def same_library(asked: str, name: str) -> bool:
    return title_of(asked).lower() == title_of(name).lower()


def is_4k(name: str) -> bool:
    return "4k" in name.lower()


def invite_libraries(libraries: list[Library], access: Access) -> list[Library]:
    """What a new invite shares: only on `INVITE_SERVERS` when it names any."""
    servers = {name.lower() for name in access.servers}
    usable = [
        lib
        for lib in libraries
        if lib.enabled
        and not access.is_private(lib.name)
        and (not servers or lib.server_name.lower() in servers)
    ]
    if access.libraries:
        return [lib for lib in usable if any(same_library(n, lib.name) for n in access.libraries)]
    return [lib for lib in usable if not is_4k(lib.name)]
