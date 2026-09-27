from dataclasses import replace

import pytest

from maester.clients.tautulli import StreamData
from maester.playback.client_limits import CLIENT_LIMITS, client_causes
from maester.playback.plays import Play, Playback, playback_of
from tests.factories import history_row, session

CLEAN = Playback(
    platform="Roku", product="Plex for Roku", player="Living Room", device="Roku Ultra",
    container="mkv", transcode_decision="direct play", video_codec="hevc",
    video_decision="direct play", dovi_profile=0, audio_codec="eac3",
    audio_decision="direct play", subtitle_codec="", subtitle_decision="", location="lan",
    relayed=False, bitrate_kbps=20000, source_bitrate_kbps=20000, transcode_speed=None,
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


def test_hevc_converted_down_away_from_home_isnt_blamed_on_the_codec():
    """Away from home, HEVC sent at 4 Mbps may be the app's remote quality as well as the
    player, which Tautulli can't tell apart; at home the rule reads it as the player's."""
    reduced = replace(CLEAN, video_decision="transcode", bitrate_kbps=4000)
    assert names(replace(reduced, location="wan")) == []
    assert names(reduced) == ["hevc_unsupported"]


def test_a_relayed_stream_isnt_blamed_on_the_players_codecs():
    """Plex's relay caps a stream at 2 Mbps, so it is transcoded whatever the player decodes."""
    relayed = replace(CLEAN, video_decision="transcode", location="wan", relayed=True)
    assert relayed.squeezed and names(relayed) == []


async def test_a_live_play_is_read_from_its_session_and_a_finished_one_from_its_stream(services):
    live = Play.from_session(
        "meleys", session(subtitle_codec="pgs", subtitle_decision="burn", dovi_profile=7)
    )
    playback = await playback_of(services, live)
    assert (playback.dovi_profile, playback.subtitle_decision) == (7, "burn")
    assert playback.with_profile(0).dovi_profile == 7  # the play already said

    row = history_row(row_id=1124, platform="Chrome", product="Plex Web")
    services.tautulli["vermithor"].streams[1124] = StreamData(
        "mkv", "hevc", "transcode", "eac3", "direct play", "", ""
    )
    finished = Play.from_history("vermithor", row, 438631)
    playback = await playback_of(services, finished)
    assert (playback.platform, playback.video_decision, playback.dovi_profile) == (
        "Chrome", "transcode", None,
    )  # fmt: skip
    assert playback.with_profile(0).dovi_profile == 0  # the file fills it in
    assert names(playback) == ["hevc_unsupported"]


def test_a_play_says_how_it_travelled():
    live = Playback.from_session(
        session(location="wan", relayed=True, stream_bitrate_kbps=1800, source_bitrate_kbps=62000,
                video_decision="transcode", transcode_speed=0.8)
    )  # fmt: skip
    assert (live.remote, live.relayed, live.bitrate_kbps, live.source_bitrate_kbps) == (
        True, True, 1800, 62000,
    )  # fmt: skip
    assert (live.transcode_speed, live.reduced, live.squeezed) == (0.8, True, True)
    # Throttled: the transcoder is ahead and resting, so its low speed isn't a reading.
    throttled = session(video_decision="transcode", transcode_speed=0.4, transcode_throttled=True)
    assert Playback.from_session(throttled).transcode_speed is None
    # A direct stream (video copied, audio converted) has a speed that isn't the video's.
    remux = session(video_decision="copy", audio_decision="transcode", transcode_speed=0.6)
    assert Playback.from_session(remux).transcode_speed is None
    local = Playback.from_session(
        session(location="lan", video_decision="transcode", stream_bitrate_kbps=8000,
                source_bitrate_kbps=62000)
    )  # fmt: skip
    assert local.reduced and not (local.remote or local.squeezed)
