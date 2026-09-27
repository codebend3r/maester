from dataclasses import replace

from maester.clients.fleet import Vitals
from maester.clients.plex import PlexItem, Version
from maester.clients.speedtest import SpeedResult
from maester.clients.tautulli import Activity
from maester.perf.lag import Fix, Stream, diagnose, live_streams
from maester.perf.load import HostLoad
from maester.perf.uplink import Uplink
from maester.perf.versions import TitleVersion
from maester.playback.plays import Playback
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


def host_load(*others, cpu=None) -> HostLoad:
    """Vermithor serving `others` (besides the stream under test), its CPU as given."""
    transcodes = sum(1 for s in others if s.transcode_decision == "transcode")
    activity = Activity(tuple(others), len(others), transcodes, 0, 0)
    return HostLoad("vermithor", activity, Vitals(cpu, 40.0) if cpu is not None else None)


def stream(*, load=None, uplink=None, versions=(), file=REMUX, **play) -> Stream:
    """A stream of Dune from vermithor: a direct-played 62 Mbps remux over the internet."""
    base = dict(
        location="wan", stream_bitrate_kbps=62103, source_bitrate_kbps=62103, file=file,
        video_decision="direct play", audio_decision="direct play",
    )  # fmt: skip
    live = session(**{**base, **play})
    return Stream(
        "Dune", "vermithor", live.file, Playback.from_session(live), load or host_load(),
        uplink, versions,
    )  # fmt: skip


def uplink(spare_mbps: float, streaming_kbps: int = 18000) -> Uplink:
    return Uplink("meleys", SpeedResult(spare_mbps, 900.0, 9.0, "Rogers", "Rogers", "u"), streaming_kbps, ())  # fmt: skip


def advice(s: Stream):
    return diagnose(s).findings[0]


def names(s: Stream) -> list[str]:
    return [f.name for f in diagnose(s).findings]


BEHIND = session(transcode_decision="transcode", transcode_speed=0.6)


def test_burned_in_subtitles_come_first_and_explain_a_busy_server():
    burn = stream(
        location="lan", subtitle_codec="pgs", subtitle_decision="burn", video_decision="transcode",
        transcode_decision="transcode", transcode_speed=0.7, load=host_load(BEHIND, cpu=97.0),
    )  # fmt: skip
    found = advice(burn)
    assert (found.fix, found.name) == (Fix.SUBTITLES_OFF, "image_subtitle_burn_in")
    assert "Turn subtitles off" in found.advice
    assert names(burn) == ["image_subtitle_burn_in"]  # not the HEVC rule, not the busy server


def test_a_relayed_stream_is_called_out_with_the_relay_cap():
    relayed = stream(
        relayed=True, quality_profile="2 Mbps 720p", video_decision="transcode",
        transcode_decision="transcode", stream_bitrate_kbps=1800, transcode_speed=0.8,
        uplink=uplink(3.0),
    )  # fmt: skip
    found = advice(relayed)
    assert found.fix is Fix.AVOID_RELAY
    assert "relay, which carries at most 2 Mbps" in found.cause
    assert "set remote quality to 2 Mbps 720p" in found.advice
    assert "Enable Relay" in found.advice
    # A relayed HEVC transcode is the relay's doing, not the player's codecs or the upload.
    assert names(relayed) == ["relayed"]
    assert (
        "relayed through Plex, which carries at most 2 Mbps" in diagnose(relayed).brief()["stream"]
    )


def test_a_lowered_remote_quality_that_cant_keep_up_asks_for_original():
    lowered = stream(
        quality_profile="4 Mbps 720p", video_codec="h264", video_decision="transcode",
        transcode_decision="transcode", stream_bitrate_kbps=4000, source_bitrate_kbps=10240,
        transcode_speed=0.7, file=WEBDL,
    )  # fmt: skip
    found = advice(lowered)
    assert found.fix is Fix.ORIGINAL_QUALITY
    assert "asks for 4 Mbps 720p away from home" in found.cause
    assert "Original (Maximum)" in found.advice and "10.2 Mbps" in found.advice
    # Keeping up, it isn't the cause; nothing else is either.
    assert names(replace(lowered, playback=replace(lowered.playback, transcode_speed=1.4))) == []


def test_converting_a_remux_down_that_cant_keep_up_asks_for_a_lighter_version():
    heavy = stream(
        quality_profile="8 Mbps 1080p", video_decision="transcode", transcode_decision="transcode",
        stream_bitrate_kbps=8000, transcode_speed=0.5, versions=VERSIONS,
    )  # fmt: skip
    found = advice(heavy)
    assert (found.fix, found.name) == (Fix.OTHER_VERSION, "converting_heavy_file")
    assert "Play the 1080p version instead (10.2 Mbps)" in found.advice


def test_a_heavy_remote_stream_is_pointed_at_a_lighter_version_or_a_lower_quality():
    heavy = stream(versions=VERSIONS, uplink=uplink(40.0))
    found = advice(heavy)
    assert (found.fix, found.name) == (Fix.OTHER_VERSION, "heavy_with_lighter")
    assert "playing the 4K version at 62.1 Mbps" in found.cause
    # The re-encode peaks past what most remote connections carry; the 1080p fits.
    assert "Play the 1080p version instead (10.2 Mbps)" in found.advice
    alone = stream()
    found = advice(alone)
    assert (found.fix, found.name) == (Fix.LOWER_QUALITY, "heavy_stream")
    assert "remote quality to 20 Mbps 1080p" in found.advice


def test_a_nearly_full_upload_asks_for_a_lower_quality():
    slow = stream(stream_bitrate_kbps=8000, source_bitrate_kbps=8000, uplink=uplink(3.2))
    found = advice(slow)
    assert (found.fix, found.name) == (Fix.LOWER_QUALITY, "uplink_full")
    assert "only 3.2 Mbps free alongside 18 Mbps" in found.cause
    assert "remote quality to 3 Mbps 720p" in found.advice


def test_a_busy_server_means_waiting():
    busy = stream(
        location="lan", stream_bitrate_kbps=8000, load=host_load(BEHIND, BEHIND, cpu=97.0)
    )
    found = advice(busy)
    assert (found.fix, found.name) == (Fix.WAIT, "server_busy")
    assert found.cause == (
        "vermithor is busy: 2 streams converting slower than playback; its CPU is at 97%."
    )


def test_hevc_the_player_cant_decode_is_its_own_cause_even_on_a_busy_server():
    hevc = stream(
        location="lan", video_decision="transcode", transcode_decision="transcode",
        transcode_speed=0.9, load=host_load(BEHIND),
    )  # fmt: skip
    assert names(hevc) == ["hevc_unsupported"] and advice(hevc).fix is Fix.OTHER_VERSION


def test_a_healthy_stream_says_nothing_on_the_server_explains_it():
    fine = stream(location="lan", stream_bitrate_kbps=8000, versions=VERSIONS, file=WEBDL)
    brief = diagnose(fine).brief()
    assert brief["advice"]["fix"] is None and "network" in brief["advice"]["what_to_do"]
    assert brief["stream"] == (
        "direct play on the home network at 8 Mbps (1080p), Plex on TV, from vermithor"
    )
    assert brief["host"] == "vermithor" and "other_findings" not in brief


def test_details_carry_every_finding_and_the_stats_behind_them():
    relayed = stream(
        relayed=True, location="lan", stream_bitrate_kbps=1800, load=host_load(BEHIND, cpu=90.0),
        versions=VERSIONS,
    )  # fmt: skip
    found = diagnose(relayed)
    assert found.brief()["other_findings"] == 1
    details = found.details()
    assert [f["fix"] for f in details["findings"]] == [Fix.AVOID_RELAY, Fix.WAIT]
    assert details["playback"]["relayed"] is True and details["host_load"]["busy"] is True
    assert details["uplink"] == "not tested in the last 10 minutes"
    assert [v["version"] for v in details["versions"]] == ["4K", "4K HEVC re-encode", "1080p"]


async def test_live_streams_are_the_friends_own_with_their_titles_versions(services):
    services.seerr.details[("movie", 438631)] = DUNE
    services.plex.items = {
        "9001": PlexItem("9001", "Dune", "movie", 2021, ("tmdb://438631",), tuple(v.version for v in VERSIONS[:2])),
        "4348": PlexItem("4348", "Dune", "movie", 2021, ("tmdb://438631",), (VERSIONS[2].version,)),
    }  # fmt: skip
    mine = session(user_id=7, rating_key="9001", file=REMUX, full_title="Dune")
    theirs = session(user_id=8, rating_key="9001")
    load = host_load(mine, theirs)
    (found,) = await live_streams(services, {"vermithor": load}, 7, None)
    assert (found.title, found.host, found.playing.name) == ("Dune", "vermithor", "4K")
    assert [v.name for v in found.versions] == ["1080p", "4K", "4K HEVC re-encode"]
    unknown = session(user_id=7, rating_key="555")  # Plex no longer has it: no versions
    (found,) = await live_streams(services, {"vermithor": host_load(unknown)}, 7, None)
    assert found.versions == () and found.playing is None
