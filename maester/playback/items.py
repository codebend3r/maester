"""The copy of a title a friend reports on, and the file behind it.

A title can have a 1080p and a 4K copy on different hosts, and a show's
episodes are files of their own, so an `Item` names the copy and, for a
show, the episode. `ref` is how an item reads back in a pick ("movie:
438631:4K", "tv:136315:1080p:S02E07").

`locate` finds the item's file the only way maester ever finds a file:
through the arr that owns the copy (`maester/library.py`, never guessed)
and that arr's file records. Every probe and every replacement starts here.
"""

from __future__ import annotations

from dataclasses import dataclass

from maester.clients import Services
from maester.clients.arr import MediaFile
from maester.clients.seerr import MediaDetails
from maester.library import Library, Owner


def episode_code(season: int | None, episode: int | None) -> str:
    """ "S02E07"; empty for a movie."""
    if season is None or episode is None:
        return ""
    return f"S{season:02d}E{episode:02d}"


def item_ref(media_type: str, tmdb_id: int, version: str, code: str = "") -> str:
    """How a copy reads in a pick; `version` is "?" when it isn't known."""
    return ":".join(part for part in (media_type, str(tmdb_id), version, code) if part)


def item_title(details: MediaDetails, code: str = "") -> str:
    """ "Dune (2021)", or "The Bear (2022) S02E07"."""
    return f"{details.display} {code}" if code else details.display


@dataclass(frozen=True)
class Item:
    media_type: str  # "movie" | "tv"
    tmdb_id: int
    is_4k: bool
    season: int | None = None
    episode: int | None = None

    def __post_init__(self) -> None:
        numbered = self.season is not None and self.episode is not None
        if self.media_type == "tv" and not numbered:
            raise ValueError("a show's report needs the season and the episode")
        if self.media_type == "movie" and (self.season is not None or self.episode is not None):
            raise ValueError("a movie has no season or episode")

    @classmethod
    def of(
        cls,
        media_type: str,
        tmdb_id: int,
        version: str,
        season: int | None = None,
        episode: int | None = None,
    ) -> Item:
        """From a tool's arguments, where the copy is named "1080p" or "4K"."""
        return cls(media_type, tmdb_id, version.lower() == "4k", season, episode)

    @property
    def version(self) -> str:
        return "4K" if self.is_4k else "1080p"

    @property
    def code(self) -> str:
        return episode_code(self.season, self.episode)

    @property
    def ref(self) -> str:
        return item_ref(self.media_type, self.tmdb_id, self.version, self.code)

    def title(self, details: MediaDetails) -> str:
        return item_title(details, self.code)


class NotOnServer(LookupError):
    """The owning arr has no file for this copy or episode; the message says what's missing."""


@dataclass(frozen=True)
class LocatedFile:
    """An item's file, as the arr that owns the copy records it."""

    item: Item
    details: MediaDetails
    owner: Owner
    file: MediaFile
    episode_ids: tuple[int, ...] = ()  # for a show: every episode this file holds

    @property
    def title(self) -> str:
        return self.item.title(self.details)

    @property
    def copy(self) -> str:
        """ "the 4K copy of Dune (2021)"."""
        return f"the {self.item.version} copy of {self.title}"

    @property
    def runtime(self) -> float | None:
        """How long the file should run, in seconds: a movie's runtime.

        A show's runtime is only typical, and a short episode must not pass
        for a truncated one, so episodes have none.
        """
        minutes = self.details.runtime_minutes
        return minutes * 60.0 if minutes and self.item.media_type == "movie" else None


async def locate(services: Services, item: Item) -> LocatedFile:
    """The item's file on its owning host; `NotOnServer` or `OwnerUnknown` when it can't be named."""
    details = await services.seerr.media_details(item.media_type, item.tmdb_id)
    owner = await (await Library.load(services)).owner(details, is_4k=item.is_4k)
    if owner is None:
        raise NotOnServer(f"no Radarr or Sonarr holds the {item.version} copy of {details.display}")
    files = {f.id: f for f in await owner.files()}
    if item.media_type == "movie":
        if not files:
            raise NotOnServer(f"{details.display} has no {item.version} file on {owner.host}")
        # Radarr keeps one file per movie.
        return LocatedFile(item, details, owner, next(iter(files.values())))
    episodes = await owner.arr.episodes(owner.media_id)  # type: ignore[union-attr]
    wanted = next(
        (e for e in episodes if (e.season, e.number) == (item.season, item.episode)), None
    )
    if wanted is None:
        raise NotOnServer(f"Sonarr on {owner.host} has no {item.code} of {details.display}")
    if wanted.file_id not in files:
        raise NotOnServer(f"{item.title(details)} has no file on {owner.host}")
    file = files[wanted.file_id]
    held = tuple(e.id for e in episodes if e.file_id == file.id)
    return LocatedFile(item, details, owner, file, held)
