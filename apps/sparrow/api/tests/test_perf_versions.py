from sparrow.clients.raven import RavenItem, RavenTitle
from sparrow.clients.seerr import MediaDetails, MediaStatus
from sparrow.clients.speedtest import SpeedResult
from sparrow.perf.uplink import Uplink
from sparrow.perf.versions import (
    TYPICAL_AWAY,
    Connection,
    Limit,
    best_fitting,
    item_for,
    quality_for,
    quality_label,
    recommend,
)
from tests.factories import raven_file

REMUX = raven_file()
HD = raven_file(id=402, width=1920, video_codec="h264", hdr=False, bitrate_kbps=10_200)
UNPROBED = raven_file(id=403, bitrate_kbps=None)
DUNE = MediaDetails(438631, "movie", "Dune", 2021, "", MediaStatus.AVAILABLE, MediaStatus.UNKNOWN)


def test_raven_s_sizes_by_bitrate_and_by_key():
    assert quality_for(25_000) == "1080p HD (High)"
    assert quality_for(5_000) == "720p HD (High)"
    assert quality_for(100) == "328p"
    assert quality_label("high720") == "720p HD (High)" and quality_label(None) is None


def test_the_tightest_known_limit_counts_and_a_typical_one_stands_in():
    uplink = Uplink("meleys", SpeedResult(6_000, 1, 1.0, "s", "i", "u"))
    known = Connection.of(said_mbps=20, uplink=uplink, streaming_kbps=4_000)
    assert known.limit() == Limit(
        10_000, "the servers' free upload at the last test, with what your stream already takes"
    )
    assert Connection.of().limit() == TYPICAL_AWAY
    assert Connection.of(said_mbps=50).limit(lagging_away=True) == TYPICAL_AWAY


def test_a_file_fits_with_room_for_its_peaks_and_unprobed_files_are_left_out():
    assert best_fitting([REMUX, HD, UNPROBED], Limit(20_000, "x")) == HD
    assert best_fitting([REMUX, HD], None) == REMUX  # the home network carries anything
    assert best_fitting([REMUX], Limit(20_000, "x")) is None
    pick = recommend([REMUX, HD], Limit(10_000, "x"))
    assert (pick.file, pick.fits, pick.quality) == (HD, False, "Convert to 1080p HD (Standard)")
    assert recommend([HD], Limit(20_000, "x")).quality == "Play original quality"
    assert recommend([UNPROBED], Limit(20_000, "x")) is None


async def test_raven_s_movie_is_the_one_whose_tmdb_id_is_seerr_s(services):
    raven = services.raven
    raven.titles = [
        RavenTitle(4, "4K Movies", "movie", "Dune", 2021, 40),
        RavenTitle(6, "Movies", "movie", "Dune", 1984, 41),
        RavenTitle(7, "TV Shows", "show", "Dune: Prophecy", 2024, 42),
    ]
    raven.items = {
        40: RavenItem(40, "movie", "Dune", 2021, 438631, (REMUX, HD)),
        41: RavenItem(41, "movie", "Dune", 1984, 841, ()),
    }
    assert (await item_for(raven, DUNE)).id == 40
    raven.items.pop(40)  # one raven can't open is left out, not a failure
    assert await item_for(raven, DUNE) is None
