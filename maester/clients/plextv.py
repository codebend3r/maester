"""plex.tv: which libraries each friend is shared, per server, read and changed as the owner.

Friends' shares live on plex.tv, not on the servers, and Wizarr has no call
that changes one; so a library added to a friend's access is written here,
with the server owner's token (`PLEX_TOKEN`), through the XML API Plex's
own apps and plexapi use:

- `GET /api/servers`: the account's servers, by name and machine identifier
- `GET /api/servers/{machine}`: a server's libraries, with the ids shares use
- `GET /api/servers/{machine}/shared_servers`: every friend the server is
  shared with, and which libraries each has
- `PUT /api/servers/{machine}/shared_servers/{id}`: a friend's libraries on
  that server replaced (plexapi's `updateFriend`); nothing else about the
  share (downloads, Wizarr's expiry) changes
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol

from maester.clients.base import ClientError, Downable, HttpClient


@dataclass(frozen=True)
class OwnedServer:
    name: str
    machine_id: str


@dataclass(frozen=True)
class Section:
    """A library on a server, by the id plex.tv's shares name it with."""

    id: int
    title: str  # "07. Anime"


@dataclass(frozen=True)
class Share:
    """One friend's share of one server."""

    id: int  # the shared server's id, which a change is written to
    machine_id: str
    email: str
    username: str
    all_libraries: bool
    section_ids: frozenset[int]  # the libraries shared, when not all of them

    def is_for(self, email: str | None) -> bool:
        """Whether this is the share of the Plex account with `email`. Only the email: a
        username a Seerr user without a Plex account chose could be someone else's."""
        return bool(email and self.email.lower() == email.lower())


class PlexTv(Protocol):
    async def servers(self) -> list[OwnedServer]: ...
    async def sections(self, machine_id: str) -> list[Section]: ...
    async def shares(self, machine_id: str) -> list[Share]: ...
    async def set_sections(self, share: Share, section_ids: list[int]) -> None: ...


class PlexTvClient(HttpClient):
    service = "plex.tv"

    def __init__(self, base_url: str, token: str, **kwargs: Any):
        headers = {
            "X-Plex-Token": token,
            "X-Plex-Client-Identifier": "maester",
            "X-Plex-Product": "maester",
        }
        super().__init__(base_url, headers=headers, **kwargs)

    async def _xml(self, path: str) -> ET.Element:
        response = await self.request("GET", path)
        try:
            return ET.fromstring(response.text)
        except ET.ParseError as exc:
            raise ClientError(self.service, "GET", path, response.status_code, "not XML") from exc

    async def servers(self) -> list[OwnedServer]:
        root = await self._xml("/api/servers")
        return [
            OwnedServer(s.get("name") or "", s.get("machineIdentifier") or "")
            for s in root.iter("Server")
            if s.get("machineIdentifier")
        ]

    async def sections(self, machine_id: str) -> list[Section]:
        root = await self._xml(f"/api/servers/{machine_id}")
        return [
            Section(int(s.get("id") or 0), s.get("title") or "")
            for s in root.iter("Section")
            if s.get("id")
        ]

    async def shares(self, machine_id: str) -> list[Share]:
        root = await self._xml(f"/api/servers/{machine_id}/shared_servers")
        return [
            Share(
                id=int(shared.get("id") or 0),
                machine_id=machine_id,
                email=shared.get("email") or "",
                username=shared.get("username") or "",
                all_libraries=shared.get("allLibraries") == "1",
                section_ids=frozenset(
                    int(s.get("id") or 0) for s in shared.iter("Section") if s.get("shared") == "1"
                ),
            )
            for shared in root.iter("SharedServer")
        ]

    async def set_sections(self, share: Share, section_ids: list[int]) -> None:
        body = {
            "server_id": share.machine_id,
            "shared_server": {"library_section_ids": sorted(section_ids)},
        }
        # plex.tv answers with the share as XML, which isn't needed: the request is the change.
        await self.request(
            "PUT", f"/api/servers/{share.machine_id}/shared_servers/{share.id}", json=body
        )


@dataclass
class FakePlexTv(Downable):
    service: ClassVar[str] = "plex.tv"

    owned: list[OwnedServer] = field(default_factory=list)
    libraries: dict[str, list[Section]] = field(default_factory=dict)  # by machine id
    shared: dict[str, list[Share]] = field(default_factory=dict)  # by machine id
    # Each change written: the share and the libraries it now holds.
    written: list[tuple[int, list[int]]] = field(default_factory=list)

    async def servers(self) -> list[OwnedServer]:
        self.refuse_if_down("/api/servers")
        return list(self.owned)

    async def sections(self, machine_id: str) -> list[Section]:
        return list(self.libraries.get(machine_id, []))

    async def shares(self, machine_id: str) -> list[Share]:
        return list(self.shared.get(machine_id, []))

    async def set_sections(self, share: Share, section_ids: list[int]) -> None:
        self.refuse_if_down(f"/api/servers/{share.machine_id}/shared_servers/{share.id}")
        self.written.append((share.id, sorted(section_ids)))
        self.shared[share.machine_id] = [
            Share(s.id, s.machine_id, s.email, s.username, s.all_libraries, frozenset(section_ids))
            if s.id == share.id
            else s
            for s in self.shared.get(share.machine_id, [])
        ]
