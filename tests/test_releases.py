from datetime import UTC, datetime, timedelta

import pytest

from maester.media import Copy, Decision, ReportKind
from maester.releases import bad_releases, group_from_name, new_bad_releases, release_group


@pytest.mark.parametrize(
    ("path", "group"),
    [
        ("/m/Dune.2021.2160p.UHD.BluRay.x265-FraMeSToR.mkv", "FraMeSToR"),
        (
            "/m/Dune (2021) {tmdb-438631} [Bluray-2160p][DV HDR10][TrueHD 7.1][x265]-FLUX.mkv",
            "FLUX",
        ),
        ("/tv/The.Bear.S02E07.1080p.WEB.H264-NTb[rarbg].mkv", "NTb"),
        ("/tv/The Bear - S02E07 - Forks [WEBDL-1080p].mkv", None),  # no group in the name
        ("/m/Dune.2021.1080p.WEB-DL.mkv", None),  # "DL" is half of WEB-DL, not a group
        ("/m/Dune.2021-1080p.mkv", None),
        ("/m/Dune.mkv", None),
    ],
)
def test_a_release_group_is_read_from_the_end_of_a_file_name(path, group):
    assert group_from_name(path) == group


def test_the_arrs_word_for_a_group_wins_over_the_file_name():
    assert release_group("FLUX", "/m/Dune.2021-OTHER.mkv") == "FLUX"
    assert release_group(None, "/m/Dune.2021-OTHER.mkv") == "OTHER"


def filed(store, file_id, group, *, who="d1", decision=Decision.RECORDED, host="vermithor"):
    return store.add_report(
        discord_id=who, kind=ReportKind.WONT_PLAY, copy=Copy("movie", file_id, True),
        title=f"Movie {file_id} (2021)", rating_key=None, host=host, file_id=file_id,
        file_path=f"/m/{file_id}.mkv", release_group=group, health="corrupt", diagnosis={},
        description="", decision=decision,
    )  # fmt: skip


def test_files_are_counted_per_group_not_reports_and_player_limits_dont_count(store):
    filed(store, 1, "FLUX")
    filed(store, 1, "FLUX", who="d2")  # one file, two friends: still one bad file
    filed(store, 2, "FLUX")
    filed(store, 3, "FLUX", decision=Decision.ADVISED)  # the player's fault, not the file's
    filed(store, 4, "NTb")
    filed(store, 5, None)
    reports = store.file_reports_since(datetime.now(UTC) - timedelta(days=30))
    assert [b.group for b in bad_releases(reports, 2)] == ["FLUX"]
    (flux,) = bad_releases(reports, 2)
    assert flux.files == ("Movie 1 (2021) in 4K on vermithor", "Movie 2 (2021) in 4K on vermithor")
    assert flux.suggestion().startswith("FLUX: 2 reported files in 30 days (Movie 1 (2021)")
    assert "Release Group condition `^FLUX$` scored -10000" in flux.suggestion()
    assert bad_releases(reports, 3) == []


def test_a_bad_group_is_suggested_once_a_window(store):
    for n in (1, 2, 3):
        filed(store, n, "FLUX")
    assert [b.group for b in new_bad_releases(store, 3)] == ["FLUX"]
    assert new_bad_releases(store, 3) == []
