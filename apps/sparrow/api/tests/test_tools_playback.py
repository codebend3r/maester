from datetime import UTC, datetime, timedelta

import pytest

from sparrow.agent.tools import Failed, Ok, Refused
from sparrow.clients.raven import Played, RavenItem
from sparrow.library import NotLocated
from sparrow.media import Copy
from sparrow.playback.items import locate
from sparrow.playback.plays import recent_plays
from sparrow.tools.playback import NOTHING_RECENT, list_tracks, recent_sessions
from tests.factories import raven_file
from tests.playback_world import DUNE, FORKS, stock

UHD = raven_file(id=401)
HD = raven_file(id=402, width=1920, video_codec="h264", hdr=False, bitrate_kbps=10_200)
FORKS_FILE = raven_file(id=501, title="Forks", width=1920, video_codec="h264", hdr=False)


def ago(**delta) -> str:
    return (datetime.now(UTC) - timedelta(**delta)).isoformat()


@pytest.fixture
def library(ctx):
    return stock(ctx)


@pytest.fixture
def watched(library):
    """Dune's 4K file played a minute ago, The Bear's S02E07 two hours ago, Dune again
    before that, and a file raven never matched."""
    raven = library.services.raven
    raven.items = {
        40: RavenItem(40, "movie", "Dune", 2021, 438631, (UHD, HD)),
        8: RavenItem(8, "show", "The Bear", 2022, 136315, ()),
        9: RavenItem(9, "episode", "Forks", 2023, None, (FORKS_FILE,)),
    }
    raven.plays = [
        Played(401, ago(minutes=1), "4K Movies", "Dune", 40),
        Played(501, ago(hours=2), "TV Shows", "Forks", 9, "The Bear", 8, 2, 7),
        Played(401, ago(days=2), "4K Movies", "Dune", 40),
        Played(777, ago(days=3), "Other", "home video", None),
    ]
    return library


async def test_recent_sessions_offers_each_play_as_its_copy_and_episode(watched):
    out = await recent_sessions(watched)
    assert isinstance(out, Ok)
    dune, forks = out.choices
    assert (dune.label, dune.value) == ("Dune (2021)", "movie:438631:4K")
    assert dune.detail == "4K · about 1 min ago · 4K Movies"
    assert (forks.label, forks.value) == ("The Bear (2022) S02E07", "tv:136315:1080p:S02E07")
    assert out.content["notes"] == ["raven hasn't matched home video to a title"]
    assert watched.services.raven.viewers  # read as the asker


async def test_a_play_raven_no_longer_holds_the_file_of_asks_which_copy(watched):
    watched.services.raven.items[40] = RavenItem(40, "movie", "Dune", 2021, 438631, ())
    found = await recent_plays(watched.services.raven)
    assert found.plays[0].is_4k is None
    out = await recent_sessions(watched)
    assert out.choices[0].value == "movie:438631:?"


async def test_recent_sessions_without_plays_points_to_search(library):
    out = await recent_sessions(library)
    assert out == {"sessions": [], "note": NOTHING_RECENT}
    library.services.raven.down = True
    down = await recent_sessions(library)
    assert isinstance(down, Failed) and NOTHING_RECENT in down.content


def test_a_copy_names_its_version_and_episode():
    assert Copy.of("tv", 136315, "4k", 2, 7).ref == "tv:136315:4K:S02E07"
    assert Copy.of("movie", 438631, "1080p").title(DUNE.display) == "Dune (2021)"
    assert Copy("tv", 136315, False).ref == "tv:136315:1080p"  # a whole show
    with pytest.raises(ValueError, match="season and the episode"):
        Copy("tv", 136315, False, 2)
    with pytest.raises(ValueError, match="no season"):
        Copy("movie", 438631, False, 1, 1)


async def test_locate_finds_the_file_of_a_copy_through_its_owning_arr(library):
    dune = await locate(library.services, Copy("movie", 438631, True))
    assert (dune.owner.host, dune.file.id, dune.label) == (
        "vermithor", 55, "the 4K copy of Dune (2021)",
    )  # fmt: skip
    forks = await locate(library.services, Copy("tv", 136315, False, 2, 7))
    assert (forks.owner.host, forks.file.path, forks.search_ids) == ("meleys", FORKS, (702,))
    assert forks.title == "The Bear (2022) S02E07"

    for copy, why in (
        (Copy("movie", 438631, False), "has no 1080p file on meleys"),
        (Copy("tv", 136315, False, 2, 8), "S02E08 has no file on meleys"),
        (Copy("tv", 136315, False, 9, 1), "has no S09E01 of The Bear"),
        (Copy("tv", 136315, False), "name the episode of The Bear"),
        (Copy("tv", 136315, True, 2, 7), "The 4K copy of The Bear \\(2022\\) isn't in Sonarr yet"),
    ):
        with pytest.raises(NotLocated, match=why):
            await locate(library.services, copy)


async def test_list_tracks_reads_the_files_own_tracks(library):
    out = await list_tracks(library, 438631, "movie", "4K")
    assert out["title"] == "Dune (2021)" and out["version"] == "4K"
    assert out["audio"] == [
        {"language": "eng", "codec": "truehd", "title": "TrueHD Atmos 7.1", "channels": 8,
         "english": True, "flags": ["default"]},
        {"language": "und", "codec": "ac3", "title": "English Dub", "channels": 6, "english": True},
    ]  # fmt: skip
    assert out["subtitles"] == [
        {"language": "eng", "codec": "hdmv_pgs_subtitle"},
        {"language": "es", "codec": "srt", "title": "Dune.es.forced.srt", "flags": ["forced", "file"]},
    ]  # fmt: skip


async def test_list_tracks_says_why_when_it_cannot(library):
    library.services.probe.files.pop(FORKS)
    out = await list_tracks(library, 136315, "tv", "1080p", 2, 7)
    assert isinstance(out, Refused) and out.content.startswith(
        "The file couldn't be read: unreadable: "
    )
    out = await list_tracks(library, 136315, "tv", "1080p", 2, 8)
    assert out == Refused("The Bear (2022) S02E08 has no file on meleys")
    out = await list_tracks(library, 438631, "movie", "4K", 1, 1)
    assert out == Refused("a movie has no season or episode")
