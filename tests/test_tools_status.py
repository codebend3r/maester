from dataclasses import replace

import pytest

from maester.clients.arr import HistoryEvent, QueueItem
from maester.clients.radarr import Movie
from maester.clients.sabnzbd import Download
from maester.clients.seerr import ArrRef, MediaDetails, MediaStatus, RequestStatus, Season
from maester.clients.sonarr import Series
from maester.tools.status import humanized, request_status, seconds_left
from tests.factories import seerr_server

S = MediaStatus
DUNE = MediaDetails(438631, "movie", "Dune", 2021, "", S.PROCESSING, S.UNKNOWN)
BEAR = MediaDetails(
    136315, "tv", "The Bear", 2022, "", S.PROCESSING, S.UNKNOWN, tvdb_id=403245,
    seasons=(Season(2, 10, S.PROCESSING, S.UNKNOWN),),
)  # fmt: skip


def queued(qid, media_id, size, left, download_id, time_left="00:10:00", **kw):
    return QueueItem(qid, f"item {qid}", "downloading", size, left, time_left, (), download_id, media_id, **kw)  # fmt: skip


@pytest.fixture
def dune_on_meleys(ctx):
    seerr = ctx.services.seerr
    seerr.details[("movie", 438631)] = DUNE
    seerr.auto_approve = True
    ctx.services.radarr["meleys"].movie_list = [
        Movie(8, "Dune", 438631, 2021, "/Meleys/Movies/Dune (2021)", True, False, None)
    ]
    return ctx


async def request(ctx, media_type, tmdb_id, **kw):
    return await ctx.services.seerr.create_request(media_type, tmdb_id, as_user=4, **kw)


def test_time_left_parses_both_formats():
    assert seconds_left("0:03:10") == 190 and seconds_left("00:03:10") == 190
    assert seconds_left("1.02:03:04") == 93784 and seconds_left("1:02:03:04") == 93784
    assert seconds_left(None) is None and seconds_left("soon") is None
    assert [humanized(s) for s in (20, 190, 3600, 7500, 93784)] == [
        "about 1 min", "about 3 min", "about 1 h", "about 2 h 5 min", "about 1 d 2 h"
    ]  # fmt: skip


async def test_sabnzbd_progress_wins_over_the_arr_queue(dune_on_meleys):
    ctx = dune_on_meleys
    await request(ctx, "movie", 438631)
    ctx.services.radarr["meleys"].queue_items = [queued(1, 8, 12_000, 9_000, "nzo_dune")]
    ctx.services.sabnzbd["meleys"].queue_items = [
        Download("nzo_dune", "Dune", "Downloading", 60.0, 12_000, "0:04:00")
    ]
    (row,) = (await request_status(ctx))["requests"]
    assert row == {
        "request_id": 1,
        "title": "Dune (2021)",
        "version": "1080p",
        "request": "approved",
        "availability": "requested, downloading",
        "host": "meleys",
        "percent": 60.0,
        "eta": "about 4 min",
    }


async def test_a_season_is_weighted_by_size_and_waits_for_the_slowest(ctx):
    ctx.services.seerr.details[("tv", 136315)] = BEAR
    ctx.services.seerr.auto_approve = True
    await request(ctx, "tv", 136315, seasons=[2])
    sonarr = ctx.services.sonarr["vermithor"]
    sonarr.series_list = [
        Series(12, "The Bear", 403245, 2022, "/V/TV/The Bear", True, "standard", (2,))
    ]
    sonarr.queue_items = [
        queued(1, 12, 3_000, 0, "a", "00:00:00"),
        queued(2, 12, 1_000, 1_000, "b", "02:05:00"),
        queued(3, 99, 5_000, 5_000, "c"),  # another show
    ]
    (row,) = (await request_status(ctx))["requests"]
    assert row["host"] == "vermithor" and row["seasons"] == [2]
    assert row["percent"] == 75.0 and row["eta"] == "about 2 h 5 min"


async def test_stalls_are_called_out(dune_on_meleys):
    ctx = dune_on_meleys
    await request(ctx, "movie", 438631)
    ctx.services.radarr["meleys"].queue_items = [
        replace(
            queued(1, 8, 100, 50, "nzo_dune"),
            tracked_status="warning",
            error_messages=("The download is stalled with no connections",),
        )
    ]
    ctx.services.sabnzbd["meleys"].queue_items = [
        Download("nzo_dune", "Dune", "Paused", 50.0, 100, "0:00:00")
    ]
    (row,) = (await request_status(ctx))["requests"]
    assert row["stalled"] == [
        "item 1: The download is stalled with no connections",
        "item 1: paused in SABnzbd",
    ]


async def test_a_failed_download_gives_the_reason_from_history(dune_on_meleys):
    ctx = dune_on_meleys
    await request(ctx, "movie", 438631)
    radarr = ctx.services.radarr["meleys"]
    radarr.events[8] = [HistoryEvent(1002, "downloadFailed", "Dune", "2026-09-20", "nzo_dune", "")]
    ctx.services.sabnzbd["meleys"].history_items = [
        Download("nzo_dune", "Dune", "Failed", 0, 0, None, "Out of retention")
    ]
    (row,) = (await request_status(ctx))["requests"]
    assert row["failed"] == "the last download failed: Out of retention"

    radarr.events[8] = [HistoryEvent(1003, "grabbed", "Dune", "2026-09-21", "nzo_2", "")]
    (row,) = (await request_status(ctx))["requests"]
    assert row["download"].startswith("nothing downloading right now")


async def test_pending_unowned_and_ambiguous_requests(ctx):
    seerr = ctx.services.seerr
    seerr.details[("movie", 438631)] = DUNE
    assert (await request_status(ctx))["requests"] == []
    await request(ctx, "movie", 438631)
    (row,) = (await request_status(ctx))["requests"]
    assert row["request"] == "pending" and "host" not in row and "download" not in row

    await seerr.approve_request(1)
    (row,) = (await request_status(ctx))["requests"]
    assert row["download"] == "not sent to Radarr or Sonarr yet"

    movie = Movie(8, "Dune", 438631, 2021, "/x", True, False, None)
    for host in ("meleys", "vermithor"):
        ctx.services.radarr[host].movie_list = [movie]
    (row,) = (await request_status(ctx))["requests"]
    assert "meleys and vermithor" in row["download"]


async def test_only_the_callers_open_requests_are_listed(dune_on_meleys):
    ctx = dune_on_meleys
    await ctx.services.seerr.create_request("movie", 438631, as_user=99)
    assert (await request_status(ctx))["requests"] == []


async def test_failed_requests_are_listed_and_queues_are_fetched_once(dune_on_meleys):
    ctx = dune_on_meleys
    seerr = ctx.services.seerr
    await request(ctx, "movie", 438631)
    await request(ctx, "movie", 438631)
    failed = await request(ctx, "movie", 438631)
    seerr.requests[-1] = replace(failed, status=RequestStatus.FAILED)
    radarr = ctx.services.radarr["meleys"]
    radarr.queue_items = [queued(1, 8, 100, 50, "nzo_dune")]
    fetches = []
    real_queue = radarr.queue

    async def counted_queue():
        fetches.append("radarr")
        return await real_queue()

    radarr.queue = counted_queue
    rows = (await request_status(ctx))["requests"]
    assert [r["request_id"] for r in rows] == [3, 2, 1]
    assert rows[0]["request"] == "failed" and rows[0]["failed"].startswith("Seerr couldn't")
    assert rows[1]["percent"] == rows[2]["percent"] == 50.0
    assert fetches == ["radarr"]


async def test_a_4k_request_follows_its_own_copy_to_the_4k_host(dune_on_meleys):
    """1080p on meleys and 4K on vermithor: each request reads its own queue."""
    ctx = dune_on_meleys
    seerr = ctx.services.seerr
    seerr.arr_servers["radarr"] = [
        seerr_server(0, "movie", "meleys"),
        seerr_server(1, "movie", "vermithor", is_4k=True),
    ]
    seerr.details[("movie", 438631)] = replace(DUNE, arr=ArrRef(0, 8), arr_4k=ArrRef(1, 31))
    ctx.services.radarr["vermithor"].movie_list = [
        Movie(31, "Dune", 438631, 2021, "/V/Movies 4K/Dune (2021)", True, False, None)
    ]
    ctx.services.radarr["vermithor"].queue_items = [queued(1, 31, 60_000, 15_000, "nzo_4k")]
    await request(ctx, "movie", 438631, is_4k=True)
    (row,) = (await request_status(ctx))["requests"]
    assert (row["version"], row["host"], row["percent"]) == ("4K", "vermithor", 75.0)


async def test_one_unreachable_host_only_spoils_its_own_rows(dune_on_meleys):
    ctx = dune_on_meleys
    seerr = ctx.services.seerr
    seerr.details[("tv", 136315)] = BEAR
    sonarr = ctx.services.sonarr["vermithor"]
    sonarr.series_list = [
        Series(12, "The Bear", 403245, 2022, "/V/TV/The Bear", True, "standard", (2,))
    ]
    sonarr.queue_items = [queued(1, 12, 100, 25, "nzo_bear")]
    await request(ctx, "movie", 438631)
    await request(ctx, "tv", 136315, seasons=[2])
    await request(ctx, "movie", 999)  # Seerr no longer knows this one

    async def down():
        raise ConnectionError("meleys radarr is down")

    ctx.services.radarr["meleys"].queue = down
    missing, bear, dune = (await request_status(ctx))["requests"]
    assert missing["title"] == "TMDB 999" and "couldn't look it up" in missing["error"]
    assert bear["percent"] == 75.0
    assert dune["error"] == "couldn't reach Radarr on meleys: meleys radarr is down"
