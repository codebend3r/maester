"""The file behind a copy a friend reports on.

`locate` finds a copy's file the only way maester ever finds a file:
through the arr that owns the copy (`maester/library.py`, never guessed)
and that arr's file records. Every probe and every replacement starts here.
"""

from __future__ import annotations

from dataclasses import dataclass

from maester.clients import Services
from maester.clients.arr import MediaFile
from maester.clients.seerr import MediaDetails
from maester.library import Owner, owner_of
from maester.media import Copy


@dataclass(frozen=True)
class LocatedFile:
    """A copy's file, as the arr that owns the copy records it."""

    copy: Copy
    details: MediaDetails
    owner: Owner
    file: MediaFile
    search_ids: tuple[int, ...]  # what the arr searches to replace it

    @property
    def title(self) -> str:
        return self.copy.title(self.details.display)

    @property
    def label(self) -> str:
        """ "the 4K copy of Dune (2021)"."""
        return f"the {self.copy.version} copy of {self.title}"

    @property
    def runtime(self) -> float | None:
        """How long the file should run, in seconds: a movie's runtime.

        A show's runtime is only typical, and a short episode must not pass
        for a truncated one, so episodes have none.
        """
        minutes = self.details.runtime_minutes
        return minutes * 60.0 if minutes and self.copy.media_type == "movie" else None


async def locate(services: Services, copy: Copy) -> LocatedFile:
    """The copy's file on its owning host; a `NotLocated` says why it can't be named."""
    details = await services.seerr.media_details(copy.media_type, copy.tmdb_id)
    owner = await owner_of(services, details, is_4k=copy.is_4k)
    held = await owner.locate(copy, details.display)
    return LocatedFile(copy, details, owner, held.file, held.search_ids)
