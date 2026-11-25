"""A friend's latest plays in raven: what they just watched, as titles Seerr knows.

"This won't play" rarely names the file, so a report starts from what the
friend played. raven keeps every sitting with a video in the viewer's own
history (`GET /api/history`), however short, so a play that failed at once
is there too. Each play names raven's item for the movie (or the episode and
its show); raven's item gives the title's TMDB id, which finds it in Seerr,
and the file played says which copy it was: a 4K file is the 4K copy.

A play whose title raven can't say (a file it never matched, a TV movie
TMDB numbers apart) is named in the notes instead of hiding the rest.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from sparrow.clients import ClientError
from sparrow.clients.raven import Played, Raven, RavenItem
from sparrow.media import MediaType

# The latest plays asked of raven.
RECENT = 10


@dataclass(frozen=True)
class Play:
    """One of the friend's plays, with the title it was of and which copy."""

    played: Played
    kind: MediaType
    tmdb_id: int
    is_4k: bool | None  # None when raven no longer holds the file played

    @property
    def season(self) -> int | None:
        return self.played.season

    @property
    def episode(self) -> int | None:
        return self.played.episode


@dataclass(frozen=True)
class Plays:
    plays: tuple[Play, ...]  # newest first, one per file
    notes: tuple[str, ...]  # what couldn't be told


class Unidentified(LookupError):
    """raven can't say which title a play was of."""


def _named(played: Played) -> str:
    return f"{played.show}: {played.title}" if played.show else played.title


async def _item(raven: Raven, item_id: int | None, played: Played) -> RavenItem:
    if item_id is None:
        raise Unidentified(f"raven hasn't matched {_named(played)} to a title")
    try:
        return await raven.item(item_id)
    except ClientError as exc:
        raise Unidentified(f"raven couldn't open {_named(played)}: {exc}") from exc


async def identify(raven: Raven, played: Played) -> Play:
    """The title and copy one play was of."""
    kind = MediaType.TV if played.show is not None else MediaType.MOVIE
    item = await _item(raven, played.item_id, played)
    title = await _item(raven, played.show_id, played) if kind == MediaType.TV else item
    if title.tmdb_id is None:
        raise Unidentified(f"TMDB has no id for {_named(played)} that Seerr knows")
    file = next((f for f in item.files if f.id == played.media_id), None)
    return Play(played, kind, title.tmdb_id, file.is_4k if file else None)


async def recent_plays(raven: Raven) -> Plays:
    """The friend's latest plays, each identified at once."""
    history = await raven.history(RECENT)
    first: dict[int, Played] = {}
    for played in history:
        first.setdefault(played.media_id, played)
    found = await asyncio.gather(
        *(identify(raven, p) for p in first.values()), return_exceptions=True
    )
    for result in found:
        if isinstance(result, BaseException) and not isinstance(result, Unidentified):
            raise result
    plays = tuple(p for p in found if isinstance(p, Play))
    return Plays(plays, tuple(str(e) for e in found if isinstance(e, Unidentified)))
