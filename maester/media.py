"""A copy of a title, and the kinds of report made about one: words every layer shares.

A leaf module: it imports nothing else from maester, so the store, the
notices, the arr owners and the playback flow can all speak of a copy
without importing each other.

A `Copy` is one version of a title: a movie, a show, or one episode of it,
in its 1080p or 4K copy. `ref` is how it reads back in a pick ("movie:
438631:4K", "tv:136315:1080p:S02E07").
"""

from __future__ import annotations

import enum
from dataclasses import dataclass


def version_label(is_4k: bool) -> str:
    """How people name a copy: "4K" or "1080p"."""
    return "4K" if is_4k else "1080p"


def episode_code(season: int | None, episode: int | None) -> str:
    """ "S02E07"; empty without an episode."""
    if season is None or episode is None:
        return ""
    return f"S{season:02d}E{episode:02d}"


def copy_ref(media_type: str, tmdb_id: int, version: str, code: str = "") -> str:
    """How a copy reads in a pick; `version` is "?" when it isn't known."""
    return ":".join(part for part in (media_type, str(tmdb_id), version, code) if part)


def titled(display: str, code: str = "") -> str:
    """ "Dune (2021)", or "The Bear (2022) S02E07"."""
    return f"{display} {code}" if code else display


@dataclass(frozen=True)
class Copy:
    media_type: str  # "movie" | "tv"
    tmdb_id: int
    is_4k: bool
    # A show's copy may name one episode; a movie's never does.
    season: int | None = None
    episode: int | None = None

    def __post_init__(self) -> None:
        if self.media_type == "movie" and (self.season is not None or self.episode is not None):
            raise ValueError("a movie has no season or episode")
        if (self.season is None) != (self.episode is None):
            raise ValueError("name both the season and the episode")

    @classmethod
    def of(
        cls,
        media_type: str,
        tmdb_id: int,
        version: str,
        season: int | None = None,
        episode: int | None = None,
    ) -> Copy:
        """From a tool's arguments, where the copy is named "1080p" or "4K"."""
        return cls(media_type, tmdb_id, version.lower() == "4k", season, episode)

    @property
    def version(self) -> str:
        return version_label(self.is_4k)

    @property
    def code(self) -> str:
        return episode_code(self.season, self.episode)

    @property
    def ref(self) -> str:
        return copy_ref(self.media_type, self.tmdb_id, self.version, self.code)

    def title(self, display: str) -> str:
        """The copy's title from its show's or movie's display title."""
        return titled(display, self.code)


@dataclass(frozen=True)
class Titled:
    """A copy with the title people know it by, as a message about it names it."""

    copy: Copy
    title: str  # "Dune (2021)"


class ReportKind(enum.StrEnum):
    WONT_PLAY = "wont_play"
    WRONG_TITLE = "wrong_title"
    WRONG_EPISODE = "wrong_episode"
    CAM = "cam"
    HARDCODED_SUBS = "hardcoded_subs"
    SUBTITLES = "subtitles"
    AUDIO = "audio"
    OTHER = "other"
