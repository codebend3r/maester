from dataclasses import replace

from maester.clients.plex import Version
from maester.clients.speedtest import SpeedResult
from maester.perf.uplink import Uplink
from maester.perf.versions import (
    TYPICAL_AWAY,
    Connection,
    Limit,
    TitleVersion,
    asked_kbps,
    quality_for,
    recommend,
)
from maester.playback.plays import Playback
from tests.factories import session

REMUX = TitleVersion("9001", Version("4k", "hevc", 62103, 1, "/m/Dune (2021) Bluray-2160p.mkv"))
REENCODE = TitleVersion("9001", Version("4k", "hevc", 18412, 1, "/m/Dune (2021) 2160p HEVC.mkv"))
WEBDL = TitleVersion("4348", Version("1080", "h264", 10240, 1, "/m/Dune (2021) WEBDL-1080p.mkv"))
ALL = (REMUX, REENCODE, WEBDL)


def at(mbps: float) -> Connection:
    return Connection((Limit(round(mbps * 1000), "test"),))


def test_the_best_version_that_fits_with_room_for_peaks():
    # 18.4 Mbps needs about 27.6 with its peaks.
    assert recommend(ALL, at(30)).version is REENCODE
    assert recommend(ALL, at(27)).version is WEBDL
    assert (
        recommend(ALL, at(100)).version is REMUX and recommend(ALL, at(100)).quality == "Original"
    )


def test_when_nothing_fits_the_lightest_is_turned_down_to_a_plex_quality():
    pick = recommend(ALL, at(5))
    assert (pick.version, pick.fits, pick.quality) == (WEBDL, False, "4 Mbps 720p")
    assert recommend(ALL, Connection(())) is None and recommend((), at(50)) is None


def test_plex_qualities_and_what_a_player_asked_for():
    assert [quality_for(k) for k in (25_000, 20_000, 2_000, 2_500, 100)] == [
        "20 Mbps 1080p", "20 Mbps 1080p", "2 Mbps 720p", "2 Mbps 720p", "720 kbps",
    ]  # fmt: skip
    assert [asked_kbps(q) for q in ("4 Mbps 720p", "1.5 Mbps 480p", "720 kbps", "Original", "")] == [
        4000, 1500, 720, None, None,
    ]  # fmt: skip


def test_a_connection_is_its_tightest_known_limit():
    last = Playback.from_session(session(relayed=True, quality_profile="4 Mbps 720p"))
    spare = Uplink("meleys", SpeedResult(30.0, 900.0, 9.0, "s", "i", "u"), 12000, ())
    connection = Connection.of(said_mbps=8, last_away=last, uplink=spare)
    assert [limit.kbps for limit in connection.limits] == [8000, 2000, 4000, 30000]
    assert connection.tightest.source == "Plex relayed your last stream, at most 2 Mbps"
    plain = Connection.of(last_away=replace(last, relayed=False, quality_profile="Original"))
    assert plain.limits == () and plain.or_typical().tightest is TYPICAL_AWAY
    assert connection.or_typical() is connection
