from dataclasses import replace

import pytest

from maester.clients.tautulli import StreamData
from maester.playback.client_limits import CLIENT_LIMITS, client_causes
from maester.playback.plays import Play, Playback, playback_of
from tests.factories import history_row, session

CLEAN = Playback(
    platform="Roku", product="Plex for Roku", player="Living Room", device="Roku Ultra",
    container="mkv", quality_profile="Original", video_codec="hevc",
    video_decision="direct play", dovi_profile=0, audio_codec="eac3",
    audio_decision="direct play", subtitle_codec="", subtitle_decision="",
)  # fmt: skip


def names(playback):
    return [limit.name for limit in client_causes(playback)]


def test_a_clean_play_runs_into_no_limit():
    assert client_causes(CLEAN) == ()


@pytest.mark.parametrize(
    ("change", "limit"),
    [
        ({"dovi_profile": 7}, "dolby_vision_profile_7"),
        ({"video_decision": "transcode"}, "hevc_unsupported"),
        ({"audio_codec": "truehd"}, "lossless_audio_passthrough"),
        ({"audio_codec": "dca", "audio_decision": "copy"}, "lossless_audio_passthrough"),
        ({"subtitle_codec": "pgs", "subtitle_decision": "burn"}, "image_subtitle_burn_in"),
    ],
)
def test_each_limit_matches_its_play_and_gives_a_fix(change, limit):
    (found,) = client_causes(replace(CLEAN, **change))
    assert found.name == limit and found.fix and found.cause
    assert found.as_dict() == {"limit": limit, "cause": found.cause, "fix": found.fix}


def test_near_misses_are_not_blamed_on_the_player():
    assert names(replace(CLEAN, dovi_profile=7, device="SHIELD Android TV")) == []
    # A finished play has no device, but the player's name usually says it.
    assert names(replace(CLEAN, dovi_profile=7, device="", player="SHIELD Android TV")) == []
    assert names(replace(CLEAN, dovi_profile=8)) == []
    assert names(replace(CLEAN, video_codec="h264", video_decision="transcode")) == []
    assert names(replace(CLEAN, audio_codec="truehd", audio_decision="transcode")) == []
    assert names(replace(CLEAN, subtitle_codec="srt", subtitle_decision="burn")) == []
    assert names(replace(CLEAN, subtitle_codec="pgs", subtitle_decision="direct play")) == []


def test_several_limits_come_back_in_table_order_less_what_one_explains():
    # A real burn-in play: burning PGS in forces the HEVC video to be transcoded, which
    # is the subtitles' doing, not a player that can't decode HEVC.
    burn_in = replace(
        CLEAN, dovi_profile=7, video_decision="transcode", subtitle_codec="pgs",
        subtitle_decision="burn",
    )  # fmt: skip
    assert names(burn_in) == ["dolby_vision_profile_7", "image_subtitle_burn_in"]
    assert names(replace(CLEAN, video_decision="transcode")) == ["hevc_unsupported"]
    assert len({limit.name for limit in CLIENT_LIMITS}) == len(CLIENT_LIMITS)


def test_a_player_asking_for_less_quality_isnt_a_codec_limit():
    """A remote player capped at 4 Mbps transcodes HEVC because of its bitrate: that's lag."""
    capped = replace(CLEAN, video_decision="transcode", quality_profile="4 Mbps 720p")
    assert names(capped) == []


async def test_a_live_play_is_read_from_its_session_and_a_finished_one_from_its_stream(services):
    live = Play.from_session(
        "meleys", session(subtitle_codec="pgs", subtitle_decision="burn", dovi_profile=7)
    )
    playback = await playback_of(services, live)
    assert (playback.dovi_profile, playback.subtitle_decision) == (7, "burn")
    assert playback.with_profile(0).dovi_profile == 7  # the play already said

    row = history_row(row_id=1124, platform="Chrome", product="Plex Web")
    services.tautulli["vermithor"].streams[1124] = StreamData(
        "mkv", "hevc", "transcode", "eac3", "direct play", "", "", "Original"
    )
    finished = Play.from_history("vermithor", row)
    playback = await playback_of(services, finished)
    assert (playback.platform, playback.video_decision, playback.dovi_profile) == (
        "Chrome", "transcode", None,
    )  # fmt: skip
    assert playback.with_profile(0).dovi_profile == 0  # the file fills it in
    assert names(playback) == ["hevc_unsupported"]
