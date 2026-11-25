from dataclasses import replace

from sparrow.clients.arr import MediaFile
from sparrow.clients.seerr import ANIME_KEYWORD, MediaDetails, MediaStatus, Season
from sparrow.clients.sonarr import Series
from sparrow.tools.availability import check_availability

S = MediaStatus
DUNE = MediaDetails(438631, "movie", "Dune", 2021, "", S.AVAILABLE, S.PROCESSING)
BEAR = MediaDetails(
    136315,
    "tv",
    "The Bear",
    2022,
    "",
    S.PARTIALLY_AVAILABLE,
    S.UNKNOWN,
    tvdb_id=403245,
    seasons=(Season(1, 8, S.AVAILABLE, S.UNKNOWN), Season(2, 10, S.PARTIALLY_AVAILABLE, S.UNKNOWN)),
)


async def test_a_movie_says_where_each_copy_stands_with_seerr(ctx):
    ctx.services.seerr.details[("movie", 438631)] = DUNE
    out = await check_availability(ctx, 438631, "movie")
    assert out == {
        "title": "Dune (2021)",
        "availability": S.AVAILABLE.label,
        "availability_4k": S.PROCESSING.label,
    }


async def test_show_seasons_and_the_sonarr_host(ctx):
    ctx.services.seerr.details[("tv", 136315)] = BEAR
    ctx.services.sonarr["meleys"].series_list = [
        Series(12, "The Bear", 403245, 2022, "/Meleys/TV/The Bear", True, "standard", (1, 2))
    ]
    out = await check_availability(ctx, 136315, "tv")
    assert out["seasons"] == [
        {"season": 1, "episodes": 8, "status": "on the server"},
        {"season": 2, "episodes": 10, "status": "partly on the server"},
    ]
    assert out["sonarr_host"] == "meleys"

    ctx.services.sonarr["vermithor"].series_list = ctx.services.sonarr["meleys"].series_list
    out = await check_availability(ctx, 136315, "tv")
    assert out["sonarr_host"] is None and "meleys and vermithor" in out["sonarr_note"]


async def test_anime_reports_english_audio_per_season(ctx):
    frieren = replace(BEAR, title="Frieren", tvdb_id=424536, keyword_ids=frozenset({ANIME_KEYWORD}))
    ctx.services.seerr.details[("tv", 136315)] = frieren
    out = await check_availability(ctx, 136315, "tv")
    assert out["anime"] is True and "english_audio" not in out  # nothing in Sonarr to read

    sonarr = ctx.services.sonarr["meleys"]
    sonarr.series_list = [
        Series(40, "Frieren", 424536, 2023, "/Syrax/Anime/Frieren", True, "anime", (1, 2))
    ]
    sonarr.file_list = [
        MediaFile(1, "/a.mkv", 1, "Bluray-1080p", None, 40, 1, ("jpn", "eng")),
        MediaFile(2, "/b.mkv", 1, "WEBDL-1080p", None, 40, 2, ("jpn",)),
    ]
    out = await check_availability(ctx, 136315, "tv")
    assert out["english_audio"] == [
        {"season": 1, "files": 1, "with_english_audio": 1, "not_analyzed": 0},
        {"season": 2, "files": 1, "with_english_audio": 0, "not_analyzed": 0},
    ]
    ctx.services.seerr.details[("tv", 136315)] = BEAR
    assert "anime" not in await check_availability(ctx, 136315, "tv")
