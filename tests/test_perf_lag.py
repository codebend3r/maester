from maester.clients.fleet import Vitals
from maester.clients.plex import PlexItem, Version
from maester.clients.speedtest import SpeedResult
from maester.clients.tautulli import Activity
from maester.perf.lag import Fix, Stream, diagnose, live_streams
from maester.perf.load import HostLoad
from maester.perf.uplink import Uplink
from maester.plex_versions import TitleVersion
from tests.factories import session
from tests.playback_world import DUNE

REMUX = "/Vermithor/Movies/Dune (2021)/Dune (2021) Bluray-2160p.mkv"
REENCODE = "/Vermithor/Movies/Dune (2021)/Dune (2021) 2160p HEVC.mkv"
WEBDL = "/Vermithor/Movies/Dune (2021)/Dune (2021) WEBDL-1080p.mkv"
VERSIONS = (
    TitleVersion("9001", Version("4k", "hevc", 62103, 72_600_000_000, REMUX)),
    TitleVersion("9001", Version("4k", "hevc", 18412, 21_500_000_000, REENCODE)),
    TitleVersion("4348", Version("1080", "h264", 10240, 12_000_000_000, WEBDL)),
)
# Another friend's stream the server converts slower than it plays.
BEHIND = session(session_key="9", user_id=99, transcode_decision="transcode", transcode_speed=0.6)


def others(*sessions, cpu=None) -> HostLoad:
    """Vermithor's other streams, and its CPU when read."""
    activity = Activity(tuple(sessions), len(sessions), 0, 0, 0)
    return HostLoad("vermithor", activity, Vitals(cpu, 40.0) if cpu is not None else None)


def stream(*, load=None, uplink=None, versions=VERSIONS, **play) -> Stream:
    """Dune from vermithor: its 62 Mbps 4K remux, direct-played over the internet."""
    base = dict(
        location="wan", stream_bitrate_kbps=62103, source_bitrate_kbps=62103, file=REMUX,
        video_decision="direct play", audio_decision="direct play",
    )  # fmt: skip
    return Stream.of("vermithor", session(**{**base, **play}), load or others(), uplink, versions)


def converted(**play) -> Stream:
    """The same, converted (transcoded) down."""
    return stream(video_decision="transcode", transcode_decision="transcode", **play)


def uplink(spare_mbps: float, streaming_kbps: int = 18000) -> Uplink:
    result = SpeedResult(round(spare_mbps * 1000), 900_000, 9.0, "Rogers", "Rogers", "u")
    return Uplink("meleys", result, streaming_kbps, ())


def advice(s: Stream):
    return diagnose(s).findings[0]


def names(s: Stream) -> list[str]:
    return [f.name for f in diagnose(s).findings]


def test_burned_in_subtitles_come_first_and_explain_the_conversion():
    burn = converted(
        location="lan", subtitle_codec="pgs", subtitle_decision="burn", stream_bitrate_kbps=20000,
        transcode_speed=0.7, load=others(BEHIND, cpu=97.0),
    )  # fmt: skip
    found = advice(burn)
    assert (found.fix, found.name) == (Fix.SUBTITLES_OFF, "image_subtitle_burn_in")
    assert "Turn subtitles off" in found.said.advice
    # Not the HEVC rule, not its own conversion; the other busy streams stay a detail.
    assert names(burn) == ["image_subtitle_burn_in", "server_busy"]


def test_a_relayed_stream_is_called_out_with_the_relay_cap():
    relayed = converted(
        relayed=True, stream_bitrate_kbps=1800, transcode_speed=1.8, uplink=uplink(3.0)
    )
    found = advice(relayed)
    assert found.fix is Fix.AVOID_RELAY
    assert "relay, which carries at most 2 Mbps" in found.said.cause
    assert "set remote quality to 2 Mbps 720p" in found.said.advice
    assert "Enable Relay" in found.said.advice
    # A relayed HEVC conversion is the relay's doing, not the player's codecs or the upload.
    assert names(relayed) == ["relayed"]
    assert (
        "relayed through Plex, which carries at most 2 Mbps" in diagnose(relayed).brief()["stream"]
    )


def test_remote_hevc_converted_down_is_never_read_as_the_codec():
    """Tautulli can't say whether the app's quality or its codecs force it, so the fix is the
    one that's right either way: an H.264 version that plays without converting."""
    squeezed = converted(stream_bitrate_kbps=8000, transcode_speed=0.5)
    found = advice(squeezed)
    assert (found.fix, found.name) == (Fix.OTHER_VERSION, "behind_easier")
    assert found.said.advice.startswith("Play the 1080p version instead (10.2 Mbps)")
    assert "hevc_unsupported" not in names(squeezed)
    # Keeping up, the conversion isn't what lags.
    assert names(converted(stream_bitrate_kbps=8000, transcode_speed=1.3)) == []


def test_an_h264_file_converted_down_away_from_home_is_the_remote_quality():
    webdl = converted(
        file=WEBDL, video_codec="h264", stream_bitrate_kbps=4000, source_bitrate_kbps=10240,
        transcode_speed=0.7,
    )  # fmt: skip
    found = advice(webdl)
    assert (found.fix, found.name) == (Fix.ORIGINAL_QUALITY, "quality_below_file")
    assert "remote quality is set below this 10.2 Mbps file" in found.said.cause
    assert "Original (Maximum)" in found.said.advice
    assert names(webdl) == ["quality_below_file"]


def test_hevc_converted_at_home_is_the_players_codec():
    at_home = converted(
        location="lan", stream_bitrate_kbps=8000, transcode_speed=0.9, load=others(BEHIND)
    )
    assert names(at_home) == ["hevc_unsupported", "server_busy"]
    assert advice(at_home).fix is Fix.OTHER_VERSION


def test_a_heavy_remote_stream_is_pointed_at_a_lighter_version_or_a_lower_quality():
    found = advice(stream(uplink=uplink(40.0)))
    assert (found.fix, found.name) == (Fix.OTHER_VERSION, "heavy_with_lighter")
    assert "playing the 4K version at 62.1 Mbps" in found.said.cause
    # The re-encode peaks past what most remote connections carry; the 1080p fits.
    assert found.said.advice == "Play the 1080p version instead (10.2 Mbps)."
    alone = stream(versions=())
    found = advice(alone)
    assert (found.fix, found.name) == (Fix.LOWER_QUALITY, "heavy_stream")
    assert "remote quality to 20 Mbps 1080p" in found.said.advice


def test_versions_are_only_offered_when_the_stream_plays_one_of_them():
    """Versions read from one Plex server say nothing about a stream from another."""
    elsewhere = stream(file="/Meleys/Movies/Dune (2021)/Dune (2021) Remux-2160p.mkv")
    assert elsewhere.playing is None and elsewhere.lighter is None and elsewhere.easier is None
    assert names(elsewhere) == ["heavy_stream"]


def test_a_nearly_full_upload_asks_for_a_lower_quality():
    slow = stream(
        file=WEBDL, stream_bitrate_kbps=8000, source_bitrate_kbps=8000, uplink=uplink(3.2)
    )
    found = advice(slow)
    assert (found.fix, found.name) == (Fix.LOWER_QUALITY, "uplink_full")
    assert "only 3.2 Mbps free alongside 18 Mbps" in found.said.cause
    assert "remote quality to 3 Mbps 720p" in found.said.advice


def test_a_server_busy_with_other_streams_means_waiting():
    busy = stream(location="lan", file=WEBDL, stream_bitrate_kbps=10240, load=others(BEHIND, BEHIND, cpu=97.0))  # fmt: skip
    found = advice(busy)
    assert (found.fix, found.name) == (Fix.WAIT, "server_busy")
    assert found.said.cause == (
        "vermithor is busy with other streams: 2 streams converting slower than playback; its "
        "CPU is at 97%."
    )


def test_a_stream_falling_behind_on_its_own_isnt_a_busy_server():
    alone = converted(location="lan", file=WEBDL, video_codec="h264", stream_bitrate_kbps=6000,
                      source_bitrate_kbps=10240, transcode_speed=0.6)  # fmt: skip
    assert names(alone) == ["behind"]
    assert advice(alone).fix is Fix.LOWER_QUALITY


def test_a_healthy_stream_says_nothing_on_the_server_explains_it():
    fine = stream(location="lan", file=WEBDL, stream_bitrate_kbps=10240)
    brief = diagnose(fine).brief()
    assert brief["advice"]["fix"] is None and "network" in brief["advice"]["what_to_do"]
    assert brief["stream"] == (
        "direct play on the home network at 10.2 Mbps (1080p), Plex on TV, from vermithor"
    )
    assert brief["host"] == "vermithor" and "other_findings" not in brief


def test_details_carry_every_finding_and_the_stats_behind_them():
    relayed = stream(relayed=True, stream_bitrate_kbps=1800, load=others(BEHIND, cpu=90.0))
    found = diagnose(relayed)
    assert found.brief()["other_findings"] == 1
    details = found.details()
    assert [f["fix"] for f in details["findings"]] == [Fix.AVOID_RELAY, Fix.WAIT]
    assert details["playback"]["relayed"] is True
    assert details["host_load"]["other_streams"]["busy"] is True
    assert details["uplink"] == "not tested in the last 10 minutes"
    assert [v["version"] for v in details["versions"]] == ["4K", "4K HEVC re-encode", "1080p"]


async def test_live_streams_are_the_friends_own_with_versions_from_the_library_server(services):
    services.seerr.details[("movie", 438631)] = DUNE
    services.plex.items = {
        "9001": PlexItem("9001", "Dune", "movie", 2021, ("tmdb://438631",), tuple(v.version for v in VERSIONS[:2])),
        "4348": PlexItem("4348", "Dune", "movie", 2021, ("tmdb://438631",), (VERSIONS[2].version,)),
    }  # fmt: skip
    mine = session(session_key="1", user_id=7, rating_key="9001", file=REMUX, full_title="Dune",
                   tmdb_id=438631)  # fmt: skip
    theirs = session(session_key="2", user_id=8, rating_key="9001", transcode_speed=0.5,
                     transcode_decision="transcode")  # fmt: skip
    loads = {"vermithor": others(mine, theirs)}
    (found,) = await live_streams(services, loads, 7, None, frozenset({"vermithor"}))
    assert (found.play.title, found.play.host, found.playing.name) == ("Dune", "vermithor", "4K")
    assert [v.name for v in found.versions] == ["1080p", "4K", "4K HEVC re-encode"]
    assert found.load.as_dict()["streams"] == 1 and found.load.busy  # theirs, not mine
    # Served from another Plex server, the rating key means nothing to maester's.
    (found,) = await live_streams(services, loads, 7, None, frozenset({"meleys"}))
    assert found.versions == () and found.playing is None
