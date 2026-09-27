"""The copy of a title a friend reports on: a movie, or one episode of a show.

A title can have a 1080p and a 4K copy on different hosts, and a show's
episodes are files of their own, so a report names the copy and, for a
show, the episode. `ref` is how an item reads back in a pick ("movie:
438631:4K", "tv:136315:1080p:S02E07").
"""

from __future__ import annotations

from dataclasses import dataclass

from maester.clients.seerr import MediaDetails


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
