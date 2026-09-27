"""Anime and English dubs: is a show anime, and which seasons have English audio.

Anime is what TMDB tags with its anime keyword or files as Japanese
animation, or what the owning Sonarr treats as an anime series. English
audio follows the maintainer's anime dub audit (`anime-missing-dub`): a
file is dubbed when an audio track's language is English. The audit reads
tags with ffprobe; here Sonarr's own analysis of each episode file
(`mediaInfo.audioLanguages`) answers the same question without touching
the files. Sonarr exposes no track titles, so the audit's title rule
("ENG 2.0") has nothing to read, and a file Sonarr has not analyzed yet is
counted as unknown rather than guessed.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from maester.clients.arr import MediaFile
from maester.clients.seerr import MediaDetails
from maester.clients.sonarr import Series

# The audit's English language tags, plus the full name older Sonarr reports.
ENGLISH_AUDIO = frozenset({"eng", "en", "en-us", "en-gb", "english"})


def is_anime(details: MediaDetails, series: Series | None) -> bool:
    return details.anime_by_tmdb or (series is not None and series.series_type == "anime")


def has_english_audio(file: MediaFile) -> bool | None:
    if file.audio_languages is None:
        return None
    return any(lang.lower() in ENGLISH_AUDIO for lang in file.audio_languages)


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
