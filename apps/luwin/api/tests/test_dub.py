from luwin.clients.arr import MediaFile
from luwin.clients.seerr import ANIMATION_GENRE, ANIME_KEYWORD, MediaDetails, MediaStatus
from luwin.clients.sonarr import Series
from luwin.dub import dub_coverage, has_english_audio, is_anime, is_english_track

S = MediaStatus


def file(season, languages):
    return MediaFile(1, "/x.mkv", 1, "WEBDL-1080p", None, 40, season, languages)


def show(**kw):
    return MediaDetails(1, "tv", "Frieren", 2023, "", S.UNKNOWN, S.UNKNOWN, **kw)


def test_english_audio_follows_the_dub_audit_language_rule():
    assert has_english_audio(file(1, ("jpn", "eng"))) is True
    assert has_english_audio(file(1, ("Japanese", "English"))) is True  # older Sonarr
    assert has_english_audio(file(1, ("en-US",))) is True
    assert has_english_audio(file(1, ("jpn",))) is False
    assert has_english_audio(file(1, ())) is False
    assert has_english_audio(file(1, None)) is None


def test_a_track_title_says_english_when_its_tag_does_not():
    assert is_english_track("eng") and is_english_track("EN-GB")
    assert is_english_track("und", "English 2.0") and is_english_track("", "ENG")
    assert is_english_track("jpn", "Funimation Dub")
    assert not is_english_track("jpn", "Japanese 2.0") and not is_english_track("und", "Commentary")
    assert not is_english_track("jpn", "Bengali")  # "eng" inside a word isn't English


def test_coverage_per_season():
    files = [file(1, ("jpn", "eng")), file(1, ("jpn", "eng")), file(2, ("jpn",)), file(2, None)]
    assert [c.as_dict() for c in dub_coverage(files)] == [
        {"season": 1, "files": 2, "with_english_audio": 2, "not_analyzed": 0},
        {"season": 2, "files": 2, "with_english_audio": 0, "not_analyzed": 1},
    ]


def test_anime_from_tmdb_keyword_genre_or_sonarr_series_type():
    assert is_anime(show(keyword_ids=frozenset({ANIME_KEYWORD})), None)
    assert is_anime(show(genre_ids=frozenset({ANIMATION_GENRE}), original_language="ja"), None)
    assert not is_anime(show(genre_ids=frozenset({ANIMATION_GENRE}), original_language="en"), None)
    series = Series(40, "Frieren", 1, 2023, "/a", True, "anime", (1,))
    assert is_anime(show(), series) and not is_anime(show(), None)
