"""Movies and shows: which arr holds each, and how people and Seerr name it.

A movie lives in a Radarr and a show in a Sonarr; everything that differs
between the two at that level is a row here, so code that walks both arrs or
names one reads it from the table instead of spelling the choice out.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from luwin.clients import Services
from luwin.clients.arr import Arr
from luwin.media import MediaType


@dataclass(frozen=True)
class Kind:
    media_type: MediaType
    # The arr, as people name it ("Radarr on meleys").
    arr_name: str
    # The arr's service name, in Seerr's settings and in luwin's per-host registry.
    service: str
    # Every host's instance of that arr.
    arrs: Callable[[Services], Mapping[str, Arr]]


KINDS: dict[MediaType, Kind] = {
    "movie": Kind("movie", "Radarr", "radarr", lambda services: services.radarr),
    "tv": Kind("tv", "Sonarr", "sonarr", lambda services: services.sonarr),
}
