import json
import os
import sys

import pytest

from maester.clients.media import (
    Completed,
    FileProbe,
    Inspection,
    MediaPaths,
    Track,
    Unreadable,
    run_process,
    sidecar_subtitles,
)

MOVIE = "Dune (2021) Remux-2160p"


@pytest.fixture
def share(tmp_path):
    """A read-only share mounted at <tmp>/Vermithor, with one movie and its subtitle files."""
    folder = tmp_path / "Vermithor" / "Movies" / "Dune (2021)"
    folder.mkdir(parents=True)
    for name in (f"{MOVIE}.mkv", f"{MOVIE}.es.forced.srt", f"{MOVIE}.en.sdh.ass", f"{MOVIE} Extras.srt", "cover.jpg"):  # fmt: skip
        (folder / name).write_bytes(b"")
    (tmp_path / "secrets").mkdir()
    (tmp_path / "secrets" / "key.txt").write_text("nope")
    return tmp_path


class Scripted:
    """A process runner that answers from a script and records what it was asked to run."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = []

    async def __call__(self, argv, timeout):
        self.calls.append((list(argv), timeout))
        return self.answers.pop(0)


def paths(share, *, path_map=()):
    return MediaPaths([str(share / "Vermithor")], path_map)


def test_only_paths_under_a_media_root_are_readable(share):
    media = paths(share)
    inside = share / "Vermithor" / "Movies" / "Dune (2021)" / f"{MOVIE}.mkv"
    assert media.container_path(str(inside)) == os.path.realpath(inside)
    for escape in (
        str(share / "secrets" / "key.txt"),
        str(share / "Vermithor" / ".." / "secrets" / "key.txt"),
        str(share / "VermithorEvil" / "x.mkv"),  # a sibling that merely shares the prefix
    ):
        with pytest.raises(Unreadable, match="isn't under a media root"):
            media.container_path(escape)
    with pytest.raises(Unreadable, match="relative path"):
        media.container_path("Movies/Dune.mkv")
    with pytest.raises(Unreadable, match="MEDIA_ROOTS"):
        MediaPaths([]).container_path(str(inside))


def test_a_symlink_out_of_the_share_is_refused(share):
    link = share / "Vermithor" / "Movies" / "sneaky.mkv"
    link.symlink_to(share / "secrets" / "key.txt")
    with pytest.raises(Unreadable, match="isn't under a media root"):
        paths(share).container_path(str(link))


def test_an_arr_path_maps_onto_its_mount_longest_prefix_first(share):
    mount = str(share / "Vermithor")
    media = paths(share, path_map=[("/data", "/elsewhere"), ("/data/media", mount)])
    got = media.container_path("/data/media/Movies/Dune (2021)/x.mkv")
    assert got == os.path.realpath(os.path.join(mount, "Movies/Dune (2021)/x.mkv"))
    with pytest.raises(Unreadable):
        media.container_path("/data/other/x.mkv")  # mapped, but not under a root


def test_subtitle_files_next_to_the_video_are_its_external_tracks(share):
    video = share / "Vermithor" / "Movies" / "Dune (2021)" / f"{MOVIE}.mkv"
    assert sidecar_subtitles(str(video)) == (
        Track("subtitle", "ass", "en", f"{MOVIE}.en.sdh.ass", external=True),
        Track("subtitle", "srt", "es", f"{MOVIE}.es.forced.srt", forced=True, external=True),
    )


async def test_inspect_reads_duration_dolby_vision_and_every_track(share, fixture):
    video = share / "Vermithor" / "Movies" / "Dune (2021)" / f"{MOVIE}.mkv"
    run = Scripted(Completed(0, json.dumps(fixture("ffprobe_movie")), ""))
    inspection = await FileProbe(paths(share), run, timeout=30).inspect(str(video))
    ((argv, timeout),) = run.calls
    assert argv[0] == "ffprobe" and argv[-1] == f"file:{os.path.realpath(video)}"
    assert timeout == 30
    assert (inspection.duration, inspection.video_codec, inspection.dovi_profile) == (
        9331.567, "hevc", 7,
    )  # fmt: skip
    kinds = [(t.kind, t.codec, t.language, t.external) for t in inspection.tracks]
    assert kinds == [
        ("audio", "truehd", "eng", False),
        ("audio", "ac3", "spa", False),
        ("subtitle", "hdmv_pgs_subtitle", "eng", False),
        ("subtitle", "subrip", "spa", False),
        ("subtitle", "ass", "en", True),
        ("subtitle", "srt", "es", True),
    ]
    truehd, *_ = inspection.tracks
    assert (truehd.title, truehd.channels, truehd.default) == ("TrueHD Atmos 7.1", 8, True)


async def test_inspect_refuses_what_it_cannot_read(share):
    video = str(share / "Vermithor" / "Movies" / "Dune (2021)" / f"{MOVIE}.mkv")
    missing = str(share / "Vermithor" / "Movies" / "Gone.mkv")
    run = Scripted()
    probe = FileProbe(paths(share), run, timeout=5)
    with pytest.raises(Unreadable, match="no file at"):
        await probe.inspect(missing)
    with pytest.raises(Unreadable, match="isn't under a media root"):
        await probe.inspect(str(share / "secrets" / "key.txt"))
    assert run.calls == []  # neither ever reached ffprobe

    for answer, why in (
        (Completed(None, "", ""), "longer than 5 s"),
        (Completed(1, "", "moov atom not found\n"), "couldn't read it: moov atom not found"),
        (Completed(0, "garbage", ""), "wasn't JSON"),
        (Completed(0, json.dumps({"format": {}}), ""), "no duration"),
    ):
        probe = FileProbe(paths(share), Scripted(answer), timeout=5)
        with pytest.raises(Unreadable, match=why):
            await probe.inspect(video)


async def test_decode_reports_frames_and_error_lines():
    progress = "frame=120\nfps=24\nprogress=continue\nframe=240\nprogress=end\n"
    run = Scripted(Completed(0, progress, "[hevc @ 0x1] Invalid NAL unit size\n\n"))
    inspected = Inspection("/m/x.mkv", 9331.0, "hevc", 0, ())
    decoded = await FileProbe(MediaPaths(["/"]), run, timeout=9).decode(inspected, 4335.0, 30.0)
    assert (decoded.frames, decoded.errors, decoded.exit_code) == (
        240, ("[hevc @ 0x1] Invalid NAL unit size",), 0,
    )  # fmt: skip
    ((argv, _),) = run.calls
    assert argv[argv.index("-ss") + 1] == "4335.000" and argv[argv.index("-t") + 1] == "30.000"
    assert argv[argv.index("-i") + 1] == "file:/m/x.mkv"


async def test_run_process_captures_output_and_stops_what_runs_too_long():
    done = await run_process([sys.executable, "-c", "print('hi')"], 10)
    assert (done.exit_code, done.stdout.strip()) == (0, "hi")
    slow = await run_process([sys.executable, "-c", "import time; time.sleep(5)"], 0.2)
    assert slow.exit_code is None
