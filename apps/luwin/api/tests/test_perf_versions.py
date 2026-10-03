import time
from dataclasses import replace

from luwin.clients.plex import Version
from luwin.clients.speedtest import SpeedResult
from luwin.clients.tautulli import StreamData
from luwin.perf.uplink import Uplink
from luwin.perf.versions import (
    TYPICAL_AWAY,
    Connection,
    Limit,
    last_away,
    quality_for,
    recommend,
)
from luwin.playback.plays import Playback
from luwin.plex_versions import TitleVersion
from tests.factories import history_row, session

REMUX = TitleVersion("9001", Version("4k", "hevc", 62103, 1, "/m/Dune (2021) Bluray-2160p.mkv"))
REENCODE = TitleVersion("9001", Version("4k", "hevc", 18412, 1, "/m/Dune (2021) 2160p HEVC.mkv"))
WEBDL = TitleVersion("4348", Version("1080", "h264", 10240, 1, "/m/Dune (2021) WEBDL-1080p.mkv"))
ALL = (REMUX, REENCODE, WEBDL)


def at(mbps: float) -> Limit:
    return Limit(round(mbps * 1000), "test")


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
    assert recommend((), at(50)) is None


def test_plex_qualities_cap_a_converted_stream_without_room_for_peaks():
    assert [quality_for(k) for k in (25_000, 20_000, 2_000, 2_500, 100)] == [
        "20 Mbps 1080p", "20 Mbps 1080p", "2 Mbps 720p", "2 Mbps 720p", "0.7 Mbps 328p",
    ]  # fmt: skip


def test_a_connection_is_its_tightest_known_limit():
    relayed = Playback.from_session(session(relayed=True))
    spare = Uplink("meleys", SpeedResult(30_000, 900_000, 9.0, "s", "i", "u"), 12000, ())
    connection = Connection.of(said_mbps=8, away=relayed, uplink=spare)
    assert [limit.kbps for limit in connection.limits] == [8000, 2000, 30000]
    assert connection.limit().source == "Plex relays your stream, at most 2 Mbps"
    # Tautulli's quality label is only the bitrate sent, so it's no limit on the connection.
    plain = Connection.of(away=replace(relayed, relayed=False))
    assert plain.limits == () and plain.limit() is TYPICAL_AWAY
    # A stream lagging away from home is held to a typical connection too.
    roomy = Connection.of(uplink=spare)
    assert roomy.limit().kbps == 30000 and roomy.limit(lagging_away=True) is TYPICAL_AWAY


async def test_the_last_play_away_from_home_and_hosts_not_read(services):
    services.tautulli["meleys"].sessions = [session(user_id=7, location="wan", relayed=True)]
    found = await last_away(services, 7)
    assert found.playback.relayed and found.unreachable == ()
    assert (await last_away(services, None)).playback is None
    services.tautulli["meleys"].sessions = [session(user_id=7, location="lan")]
    assert (await last_away(services, 7)).playback is None


async def test_a_play_away_from_home_counts_only_while_recent(services):
    """Bug: a relayed play months ago still capped every recommendation at 2 Mbps."""
    meleys = services.tautulli["meleys"]
    now = int(time.time())
    meleys.history_rows = [
        history_row(user_id=7, row_id=1, location="wan", relayed=True, started=now - 10 * 86400)
    ]
    meleys.streams[1] = StreamData("mkv", "h264", "transcode", "aac", "transcode", "", "")
    assert (await last_away(services, 7)).playback is None  # older than RECENT_AWAY
    meleys.history_rows = [replace(meleys.history_rows[0], started=now - 2 * 86400)]
    assert (await last_away(services, 7)).playback.relayed
