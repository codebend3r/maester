import time

from maester.clients import ClientError
from maester.clients.plex import Version
from maester.clients.tautulli import Activity
from maester.perf.lag import Stream
from maester.perf.load import HostLoad
from maester.perf.reencode import candidate, flag, wan_watches
from maester.plex_versions import TitleVersion
from tests.factories import history_row, session

REMUX = TitleVersion("9001", Version("4k", "hevc", 62103, 1, "/m/Dune (2021) Bluray-2160p.mkv"))
REENCODE = TitleVersion("9001", Version("4k", "hevc", 18412, 1, "/m/Dune (2021) 2160p HEVC.mkv"))
WEBDL = TitleVersion("4348", Version("1080", "h264", 10240, 1, "/m/Dune (2021) WEBDL-1080p.mkv"))


def stream(playing: TitleVersion, *versions: TitleVersion) -> Stream:
    """The friend streaming `playing` from meleys, the server maester reads."""
    live = session(user_id=7, rating_key=playing.rating_key, file=playing.version.file,
                   full_title="Dune (2021)", location="wan")  # fmt: skip
    load = HostLoad("meleys", Activity((), 0, 0, 0, 0), None)
    return Stream.of("meleys", live, load, None, versions or (playing,))


def watched(services, *started_days_ago: float, location: str = "wan") -> None:
    now = time.time()
    services.tautulli["meleys"].history_rows += [
        history_row(rating_key="9001", location=location, user_id=n, started=int(now - d * 86400))
        for n, d in enumerate(started_days_ago)
    ]


def test_a_candidate_is_heavy_with_no_lighter_version_of_its_resolution_beside_it():
    assert candidate(REMUX, (REMUX, WEBDL))  # the 1080p is another resolution
    assert not candidate(REMUX, (REMUX, REENCODE))  # re-encoded already
    assert not candidate(WEBDL, (REMUX, WEBDL))


async def test_watches_away_from_home_in_the_window_are_counted(services):
    watched(services, 1, 5, 40)  # the last one's outside the window
    watched(services, 2, location="lan")
    assert await wan_watches(services.tautulli["meleys"], "9001") == 2

    class Down:
        async def history(self, **kw):
            raise ClientError("tautulli", "GET", "/api/v2", None, "connection refused")

    assert await wan_watches(Down(), "9001") is None


async def test_the_remux_a_stream_plays_is_flagged_once_a_window(services, store):
    watched(services, 1, 2, 3)
    notice = await flag(services, store, stream(REMUX, REMUX, WEBDL))
    assert notice.text == (
        "Dune (2021)'s 4K version (62.1 Mbps, /m/Dune (2021) Bluray-2160p.mkv) was watched "
        "away from home 3 times in the last 30 days, with no lighter 4K version beside it: a "
        "candidate for the HEVC re-encode."
    )
    assert await flag(services, store, stream(REMUX, REMUX, WEBDL)) is None  # claimed


async def test_only_the_version_playing_is_weighed(services, store):
    watched(services, 1, 2, 3)
    # Playing the 1080p, the 4K remux beside it isn't this stream's to flag.
    assert await flag(services, store, stream(WEBDL, REMUX, WEBDL)) is None
    assert await flag(services, store, stream(REMUX)) is not None


async def test_too_few_watches_or_no_known_version_flags_nothing(services, store):
    watched(services, 1, 2)
    assert await flag(services, store, stream(REMUX)) is None
    watched(services, 3)
    elsewhere = Stream.of(
        "meleys", session(user_id=7, file="/other.mkv"),
        HostLoad("meleys", Activity((), 0, 0, 0, 0), None), None, (REMUX,),
    )  # fmt: skip
    assert elsewhere.playing is None and await flag(services, store, elsewhere) is None
