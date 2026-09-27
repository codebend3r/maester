import pytest

from maester.clients.media import Decoded, FakeFileProbe, Inspection, Unreadable
from maester.playback.health import (
    Health,
    Verdict,
    Window,
    check_health,
    clock,
    decode_windows,
    judge,
    parse_clock,
)

PATH = "/Vermithor/Movies/Dune (2021)/Dune.mkv"
DUNE = Inspection(PATH, 9331.0, "hevc", 7, ())
RUNTIME = 155 * 60.0


def test_clock_both_ways():
    assert parse_clock("1:12:30") == 4350.0 and parse_clock("72:30") == 4350.0
    assert clock(4350) == "1:12:30" and clock(750) == "12:30"
    for bad in ("1h12", "12", "1:2:3:4", "a:bc"):
        with pytest.raises(ValueError, match="isn't a time"):
            parse_clock(bad)


def test_windows_sit_around_the_moment_named_or_across_the_file():
    assert decode_windows(9331.0, 4350.0) == (Window(4335.0, 30.0),)
    assert decode_windows(9331.0, 5.0) == (Window(0.0, 30.0),)
    assert decode_windows(9331.0, 9999.0) == (Window(9301.0, 30.0),)  # past the end: its end
    assert decode_windows(9331.0, None) == (
        Window(0.0, 10.0),
        Window(4665.5, 10.0),
        Window(9301.0, 10.0),
    )
    assert decode_windows(8.0, None) == (Window(0.0, 10.0), Window(4.0, 10.0))
    assert str(Window(4335.0, 30.0)) == "1:12:15-1:12:45"


def test_each_stretch_is_judged_on_errors_frames_and_time():
    w = Window(4335.0, 30.0)

    def verdicts(decoded):
        return [f.verdict for f in judge(w, decoded, 9331.0)]

    assert verdicts(Decoded(720, (), 0)) == []
    assert verdicts(Decoded(720, ("Referenced QT chapter track not found",), 0)) == []
    assert verdicts(Decoded(700, ("Invalid NAL unit size",), 0)) == [Verdict.CORRUPT]
    assert verdicts(Decoded(0, (), 0)) == [Verdict.TRUNCATED]
    assert verdicts(Decoded(0, (), None)) == [Verdict.UNREADABLE]
    assert verdicts(Decoded(0, (), 1)) == [Verdict.UNREADABLE]
    assert verdicts(Decoded(0, ("Error while decoding",), 1)) == [Verdict.CORRUPT]
    unsupported = Decoded(0, ("Not yet implemented in FFmpeg, patches welcome",), 0)
    assert verdicts(unsupported) == [Verdict.UNREADABLE]


async def test_a_clean_file_is_ok_and_only_the_stretches_are_decoded():
    probe = FakeFileProbe()
    health = await check_health(probe, DUNE, expected=RUNTIME)
    assert health == Health(
        Verdict.OK, ("decoded 0:00-0:10, 1:17:45-1:17:55, 2:35:01-2:35:11 cleanly",)
    )
    assert [start for _, start, _ in probe.decoded] == [0.0, 4665.5, 9301.0]


async def test_freezing_at_a_moment_decodes_around_it_and_finds_corruption():
    probe = FakeFileProbe(
        errors={PATH: ("[hevc @ 0x5] Invalid NAL unit size (0 > 29)", "Error while decoding")}
    )
    health = await check_health(probe, DUNE, at=4350.0, expected=RUNTIME)
    assert probe.decoded == [(PATH, 4335.0, 30.0)]
    assert health.verdict == Verdict.CORRUPT and health.verdict.failed
    assert health.evidence == (
        "decode errors at 1:12:15-1:12:45: [hevc @ 0x5] Invalid NAL unit size (0 > 29) | "
        "Error while decoding",
    )
    assert health.summary.startswith("corrupt: decode errors at 1:12:15")


async def test_a_short_or_hollow_file_is_truncated():
    half = Inspection(PATH, 3100.0, "hevc", 0, ())
    health = await check_health(FakeFileProbe(), half, expected=RUNTIME)
    assert health.verdict == Verdict.TRUNCATED
    assert health.evidence == ("it runs 51:40, well short of the 2:35:00 runtime",)

    health = await check_health(FakeFileProbe(), half, at=4350.0)
    assert health.evidence[0] == "it ends at 51:40, before 1:12:30"

    hollow = FakeFileProbe(empty={PATH})
    health = await check_health(hollow, DUNE, expected=RUNTIME)
    assert health.verdict == Verdict.TRUNCATED and len(health.evidence) == 3
    assert (
        health.evidence[0] == "nothing decodes at 0:00-0:10, though the file claims to run 2:35:31"
    )


async def test_a_file_ffmpeg_cannot_parse_is_unreadable_not_broken():
    odd = Inspection(
        PATH, 9331.0, "hevc", 0, (), ("Not yet implemented in FFmpeg, patches welcome",)
    )
    probe = FakeFileProbe()
    health = await check_health(probe, odd)
    assert health.verdict == Verdict.UNREADABLE and not health.verdict.failed
    assert probe.decoded == []
    assert Health.unreadable(Unreadable("gone")).as_dict() == {
        "verdict": "unreadable",
        "evidence": ["gone"],
    }
