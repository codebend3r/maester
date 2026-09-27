from dataclasses import replace

from maester.clients.arr import MediaFile
from maester.clients.plex import PlexItem, PlexSeason, Version
from maester.clients.seerr import ANIME_KEYWORD, MediaDetails, MediaStatus, Season
from maester.clients.sonarr import Series
from maester.perf.versions import version_name
from maester.tools.availability import check_availability

S = MediaStatus
LINK = "https://app.plex.tv/desktop/#!/server/fake-machine/details?key=%2Flibrary%2Fmetadata%2F"
DUNE = MediaDetails(
    438631,
    "movie",
    "Dune",
    2021,
    "",
    S.AVAILABLE,
    S.AVAILABLE,
    rating_key="4348",
    rating_key_4k="4400",
)
BEAR = MediaDetails(
    136315,
    "tv",
    "The Bear",
    2022,
    "",
    S.PARTIALLY_AVAILABLE,
    S.UNKNOWN,
    rating_key="5120",
    tvdb_id=403245,
    seasons=(Season(1, 8, S.AVAILABLE, S.UNKNOWN), Season(2, 10, S.PARTIALLY_AVAILABLE, S.UNKNOWN)),
)


def version(resolution, codec, gb, mbps, file):
    return Version(resolution, codec, int(mbps * 1000), int(gb * 1e9), file)


async def test_movie_versions_come_with_a_plex_link_per_copy(ctx):
    ctx.services.seerr.details[("movie", 438631)] = DUNE
    ctx.services.plex.items = {
        "4348": PlexItem("4348", "Dune", "movie", 2021, (), (version("1080", "h264", 12.0, 10.2, "/m/Dune WEBDL-1080p.mkv"),)),
        "4400": PlexItem(
            "4400",
            "Dune",
            "movie",
            2021,
            (),
            (
                version("4k", "hevc", 72.6, 62.1, "/m/Dune (2021) Bluray-2160p.mkv"),
                version("4k", "hevc", 21.5, 18.4, "/m/Dune (2021) 2160p HEVC.mkv"),
            ),
        ),
    }  # fmt: skip
    out = await check_availability(ctx, 438631, "movie")
    assert out["title"] == "Dune (2021)" and out["availability_4k"] == "on the server"
    standard, uhd = out["copies"]
    assert standard == {
        "plex_link": LINK + "4348",
        "versions": [{"version": "1080p", "codec": "h264", "size_gb": 12.0, "bitrate_mbps": 10.2}],
    }
    assert uhd["plex_link"] == LINK + "4400"
    assert [v["version"] for v in uhd["versions"]] == ["4K", "4K HEVC re-encode"]
    assert "seasons" not in out


async def test_nothing_on_the_server_has_no_copies(ctx):
    ctx.services.seerr.details[("movie", 438631)] = replace(
        DUNE, status=S.PENDING, status_4k=S.UNKNOWN, rating_key=None, rating_key_4k=None
    )
    out = await check_availability(ctx, 438631, "movie")
    assert out["copies"] == [] and out["availability"] == "requested, waiting for approval"


async def test_show_seasons_count_episodes_and_name_the_sonarr_host(ctx):
    ctx.services.seerr.details[("tv", 136315)] = BEAR
    ctx.services.plex.items["5120"] = PlexItem("5120", "The Bear", "show", 2022, (), ())
    ctx.services.plex.show_seasons["5120"] = [PlexSeason(1, 8), PlexSeason(2, 6)]
    ctx.services.sonarr["meleys"].series_list = [
        Series(12, "The Bear", 403245, 2022, "/Meleys/TV/The Bear", True, "standard", (1, 2))
    ]
    out = await check_availability(ctx, 136315, "tv")
    assert out["copies"] == [{"plex_link": LINK + "5120"}]
    assert out["seasons"] == [
        {"season": 1, "episodes_on_server": 8, "episodes_total": 8, "status": "on the server"},
        {
            "season": 2,
            "episodes_on_server": 6,
            "episodes_total": 10,
            "status": "partly on the server",
        },
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
    sonarr.files = [
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


def test_version_labels_only_call_the_servers_own_encode_a_re_encode():
    assert version_name(version("4k", "hevc", 1, 1, "/m/Dune (2021) 2160p HEVC.mkv")) == (
        "4K HEVC re-encode"
    )
    assert version_name(version("4k", "hevc", 1, 1, "/m/Dune (2021) Bluray-2160p HEVC.mkv")) == "4K"
    assert version_name(version("1080", "h264", 1, 1, "/m/a.mkv")) == "1080p"
    assert version_name(version("sd", "mpeg2", 1, 1, "/m/b.avi")) == "SD"


async def test_a_stale_plex_key_leaves_that_copy_out(ctx):
    ctx.services.seerr.details[("movie", 438631)] = DUNE
    out = await check_availability(ctx, 438631, "movie")
    assert out["copies"] == []
