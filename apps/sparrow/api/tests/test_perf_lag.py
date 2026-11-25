from sparrow.clients.raven import PlaybackMode, RavenItem
from sparrow.clients.speedtest import SpeedResult
from sparrow.perf.lag import NOTHING_FOUND, Fix, Stream, diagnose, live_streams
from sparrow.perf.uplink import Uplink
from tests.factories import live_stream, raven_file

AWAY = "203.0.113.9"
REMUX = raven_file()
HD = raven_file(id=402, width=1920, video_codec="h264", hdr=False, bitrate_kbps=10_200)
UHD_HEVC = raven_file(id=403, width=3840, video_codec="hevc", hdr=False, bitrate_kbps=18_000)


def uplink(mbps: float) -> Uplink:
    return Uplink("meleys", SpeedResult(round(mbps * 1000), 1, 1.0, "s", "i", "u"))


def advice(stream: Stream) -> dict:
    return diagnose(stream).brief()["advice"]


def test_a_conversion_at_home_points_at_a_plain_version_or_the_mac_app():
    converted = live_stream(mode=PlaybackMode.TRANSCODE)
    found = advice(Stream.of(converted, None, (REMUX, HD)))
    assert found["fix"] == Fix.OTHER_VERSION and "1080p (H.264)" in found["what_to_do"]
    alone = advice(Stream.of(converted, None, (REMUX,)))
    assert alone["fix"] == Fix.OTHER_PLAYER and "Raven, the Mac app" in alone["what_to_do"]
    # A size the viewer picked is their choice, not the player's limit.
    picked = live_stream(mode=PlaybackMode.TRANSCODE, quality="high720")
    assert advice(Stream.of(picked, None, (REMUX, HD))) == NOTHING_FOUND


def test_a_file_played_as_it_is_at_home_is_fine():
    assert advice(Stream.of(live_stream(), None, (REMUX, HD))) == NOTHING_FOUND


def test_a_remux_too_heavy_away_from_home_gets_a_lighter_version_or_a_smaller_size():
    heavy = live_stream(address=AWAY)
    lighter = advice(Stream.of(heavy, None, (REMUX, HD)))
    assert lighter["fix"] == Fix.OTHER_VERSION and "1080p (H.264)" in lighter["what_to_do"]
    smaller = advice(Stream.of(heavy, None, (REMUX,)))
    assert smaller["fix"] == Fix.LOWER_QUALITY
    assert smaller["what_to_do"] == (
        "In the player's Playback menu, under Quality, pick Convert to 1080p HD (High)."
    )


def test_a_nearly_full_upload_lowers_the_size_until_others_finish():
    hd = live_stream(file=HD, address=AWAY, send_kbps=10_200)
    found = diagnose(Stream.of(hd, uplink(1.0), (HD,)))
    assert [f.name for f in found.findings] == ["heavy_stream", "uplink_full"]
    full = found.findings[1].said
    assert "only 1 Mbps free" in full.cause and "until other streams finish" in full.advice


def test_the_brief_says_what_the_stream_does_and_details_add_the_numbers():
    stream = Stream.of(live_stream(mode=PlaybackMode.TRANSCODE, send_kbps=6_000), None, (REMUX, HD))
    brief = diagnose(stream).brief()
    assert brief["stream"] == (
        "converted on the fly (transcoded) on the home network at 6 Mbps, the 4K HDR (HEVC) "
        "file, Chrome 141 on Mac"
    )
    details = diagnose(stream).details()
    assert details["versions"] == [
        {"version": "4K HDR (HEVC)", "bitrate_mbps": 62.1},
        {"version": "1080p (H.264)", "bitrate_mbps": 10.2},
    ]
    assert details["uplink"] == "not tested in the last 10 minutes"


async def test_the_viewer_s_streams_come_with_their_title_s_files(services):
    raven = services.raven
    raven.items = {40: RavenItem(40, "movie", "Dune", 2021, 438631, (REMUX, HD, UHD_HEVC))}
    raven.mine = [live_stream(), live_stream(item_id=99), live_stream(item_id=None)]
    found = await live_streams(raven, None)
    assert [len(s.versions) for s in found] == [3, 0, 0]
