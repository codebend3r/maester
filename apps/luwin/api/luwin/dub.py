"""Anime and English dubs: is a show anime, and which seasons have English audio.

Anime is what TMDB tags with its anime keyword or files as Japanese
animation, or what the owning Sonarr treats as an anime series. English
audio follows the maintainer's anime dub audit (`anime-missing-dub`): an
audio track is English when its language tag says so, or its title does
("English 2.0", "ENG", "Dub"). Where luwin reads a file's tracks with
ffprobe (`list_tracks`, audio reports) both rules apply. A show's season
coverage comes from Sonarr's own analysis of each episode file
(`mediaInfo.audioLanguages`) instead, since probing every file would take
too long for a reply; Sonarr exposes no track titles, so only the language
rule applies there, and a file Sonarr has not analyzed yet is counted as
unknown rather than guessed.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass

from luwin.clients.arr import MediaFile
from luwin.clients.seerr import MediaDetails
from luwin.clients.sonarr import Series

# The audit's English language tags, plus the full name older Sonarr reports.
ENGLISH_AUDIO = frozenset({"eng", "en", "en-us", "en-gb", "english"})
# The audit's title rule, for tracks tagged with no language or the wrong one.
ENGLISH_TITLE = re.compile(r"\b(eng|english|dub)\b", re.IGNORECASE)


def is_anime(details: MediaDetails, series: Series | None) -> bool:
    return details.anime_by_tmdb or (series is not None and series.series_type == "anime")


def is_english_track(language: str, title: str = "") -> bool:
    """The audit's rule for one audio track: an English language tag, or a title saying so."""
    return language.lower() in ENGLISH_AUDIO or bool(ENGLISH_TITLE.search(title))


def has_english_audio(file: MediaFile) -> bool | None:
    if file.audio_languages is None:
        return None
    return any(is_english_track(lang) for lang in file.audio_languages)


@dataclass(frozen=True)
class SeasonDub:
    season: int
    files: int
    english: int
    unknown: int

    def as_dict(self) -> dict[str, int]:
        return {
            "season": self.season,
            "files": self.files,
            "with_english_audio": self.english,
            "not_analyzed": self.unknown,
        }


def dub_coverage(files: list[MediaFile]) -> list[SeasonDub]:
    """English-audio coverage of a show's episode files, per season."""
    by_season: dict[int, list[bool | None]] = defaultdict(list)
    for f in files:
        by_season[f.season or 0].append(has_english_audio(f))
    return [
        SeasonDub(
            season=n,
            files=len(verdicts),
            english=sum(1 for v in verdicts if v),
            unknown=sum(1 for v in verdicts if v is None),
        )
        for n, verdicts in sorted(by_season.items())
    ]
