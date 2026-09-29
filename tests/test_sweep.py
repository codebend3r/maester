from datetime import UTC, datetime, timedelta

import pytest

from maester.agent.limits import KillSwitch
from maester.clients import ClientError
from maester.clients.arr import QueueItem
from maester.config import Settings
from maester.jobs.sweep import Sweeper
from maester.notify import AdminPost
from maester.store import StallAction
from maester.store.base import stamp

GB = 1_000_000_000


def queued(qid, download_id, left, *, status="downloading", tracked="ok", episode=None, **kw):
    base = dict(
        id=qid, title=f"Release.{qid}", status=status, size_bytes=10 * GB, size_left_bytes=left,
        time_left=None, error_messages=(), download_id=download_id, media_id=8,
        tracked_status=tracked, episode_id=episode, media_title="Dune (2021)",
    )  # fmt: skip
    return QueueItem(**{**base, **kw})


@pytest.fixture
def sweeper(services, store):
    return Sweeper(services, store, Settings(), KillSwitch(store))


def age(store, host, kind, download_id, hours):
    """Pretend the download has been stuck for `hours` already."""
    store._conn.execute(
        "UPDATE queue_watch SET stuck_since = ? WHERE host = ? AND kind = ? AND download_id = ?",
        (stamp(datetime.now(UTC) - timedelta(hours=hours)), host, kind, download_id),
    )


async def test_a_flagged_download_is_timed_then_blocklisted_and_searched_again(
    sweeper, services, store
):
    radarr = services.radarr["meleys"]
    radarr.queue_items = [
        queued(1, "nzo_a", 6 * GB, status="warning", tracked="warning",
               error_messages=("The download is stalled with no connections",)),
    ]  # fmt: skip
    assert await sweeper() == [] and radarr.removed == []  # stuck, but not for long yet
    assert store.watched("meleys", "movie")["nzo_a"].stuck_since is not None
    age(store, "meleys", "movie", "nzo_a", hours=7)
    assert await sweeper() == []  # re-searches go in the digest, not the channel
    assert radarr.removed == [1] and radarr.searched == [[8]]
    (stall,) = store.stalls_since(datetime.now(UTC) - timedelta(hours=1))
    assert (stall.action, stall.title, stall.reason) == (
        StallAction.RESEARCHED,
        "Dune (2021)",
        "The download is stalled with no connections",
    )
    row = store.audit_recent(1)[0]
    assert (row.tool, row.host, row.ok, row.discord_id) == ("sweep_stalled", "meleys", True, None)
    await sweeper()  # it left the queue: remembered a day, in case one read just missed it
    assert store.watched("meleys", "movie")["nzo_a"].acted_at is not None
    store._conn.execute(
        "UPDATE queue_watch SET last_seen = ?", (stamp(datetime.now(UTC) - timedelta(days=2)),)
    )
    await sweeper()
    assert store.watched("meleys", "movie") == {}


async def test_a_download_that_stops_moving_is_stuck_but_waiting_is_not(sweeper, services, store):
    radarr = services.radarr["meleys"]
    radarr.queue_items = [
        queued(1, "moving", 6 * GB),
        queued(2, "frozen", 6 * GB),
        queued(3, "paused", 6 * GB, status="paused"),
        queued(4, "no client", 6 * GB, status="downloadClientUnavailable", tracked="warning"),
    ]
    await sweeper()  # first sight: nothing to compare yet
    radarr.queue_items[0] = queued(1, "moving", 5 * GB)
    await sweeper()
    watched = store.watched("meleys", "movie")
    assert watched["moving"].stuck_since is None and watched["frozen"].stuck_since is not None
    assert watched["paused"].stuck_since is None and watched["no client"].stuck_since is None
    age(store, "meleys", "movie", "frozen", hours=7)
    await sweeper()
    assert radarr.removed == [2]
    (stall,) = store.stalls_since(datetime.now(UTC) - timedelta(hours=1))
    assert stall.reason == "no progress for about 7 h"


async def test_a_season_pack_is_one_download_and_its_episodes_are_searched(
    sweeper, services, store
):
    sonarr = services.sonarr["vermithor"]
    sonarr.queue_items = [
        queued(11, "pack", GB, tracked="warning", episode=101, media_id=12,
               media_title="The Bear (2022) S02E01"),
        queued(12, "pack", GB, tracked="warning", episode=102, media_id=12,
               media_title="The Bear (2022) S02E02"),
    ]  # fmt: skip
    await sweeper()
    age(store, "vermithor", "tv", "pack", hours=7)
    await sweeper()
    assert sonarr.removed == [11] and sonarr.searched == [[101, 102]]
    (stall,) = store.stalls_since(datetime.now(UTC) - timedelta(hours=1))
    assert stall.item == "tv:12:101,102" and stall.title == "The Bear (2022) S02E01 and 1 more"
    assert stall.reason == "Sonarr marks it warning"


async def test_a_title_that_stalls_again_is_surfaced_once_instead(sweeper, services, store):
    radarr = services.radarr["meleys"]
    store.record_stall(
        host="meleys", kind="movie", item="movie:8", title="Dune (2021)", reason="stalled",
        action=StallAction.RESEARCHED,
    )  # fmt: skip
    radarr.queue_items = [queued(5, "nzo_b", 6 * GB, tracked="warning")]
    await sweeper()
    age(store, "meleys", "movie", "nzo_b", hours=7)
    (post,) = await sweeper()
    assert isinstance(post, AdminPost) and post.text.startswith(
        "Dune (2021) stalled again on meleys"
    )
    assert "left in Radarr's queue for you" in post.text and radarr.removed == []
    assert await sweeper() == []  # surfaced once, not every sweep


async def test_the_kill_switch_holds_removals_and_maintenance_pauses_the_sweep(
    sweeper, services, store
):
    radarr = services.radarr["meleys"]
    radarr.queue_items = [queued(1, "nzo_a", 6 * GB, tracked="warning")]
    await sweeper()
    age(store, "meleys", "movie", "nzo_a", hours=7)
    sweeper.kill_switch.on("bad grabs")
    await sweeper()
    assert radarr.removed == [] and store.watched("meleys", "movie")["nzo_a"].acted_at is None
    sweeper.kill_switch.off()
    store.raise_flag("maintenance", "restarting the stack")
    await sweeper()
    assert radarr.removed == []
    store.lower_flag("maintenance")
    await sweeper()
    assert radarr.removed == [1]


async def test_an_arr_that_cant_answer_is_skipped_and_the_rest_still_swept(
    sweeper, services, store
):
    services.radarr["meleys"].down = True
    services.radarr["vermithor"].queue_items = [queued(1, "nzo_v", 6 * GB, tracked="warning")]
    await sweeper()
    assert "nzo_v" in store.watched("vermithor", "movie")


async def test_a_removal_the_arr_refuses_is_recorded_and_tried_again(sweeper, services, store):
    radarr = services.radarr["meleys"]
    radarr.queue_items = [queued(1, "nzo_a", 6 * GB, tracked="warning")]
    await sweeper()
    age(store, "meleys", "movie", "nzo_a", hours=7)

    async def refuse(queue_id, *, blocklist=True):
        raise ClientError("radarr", "DELETE", f"/api/v3/queue/{queue_id}", 500, "locked")

    radarr.remove_from_queue = refuse
    await sweeper()
    (failed,) = store.stalls_since(datetime.now(UTC) - timedelta(hours=1))
    assert failed.action == StallAction.FAILED
    assert store.watched("meleys", "movie")["nzo_a"].acted_at is None  # tried again next sweep
    assert not store.audit_recent(1)[0].ok


async def test_a_download_the_arr_didnt_grab_for_a_known_title_is_left_alone(
    sweeper, services, store
):
    services.radarr["meleys"].queue_items = [
        queued(1, "by_hand", 6 * GB, tracked="warning", media_id=0)
    ]
    services.sonarr["meleys"].queue_items = [queued(2, "no_episode", 6 * GB, tracked="warning")]
    await sweeper()
    assert store.watched("meleys", "movie") == {} and store.watched("meleys", "tv") == {}


async def test_a_surfaced_download_missing_from_one_read_isnt_surfaced_again(
    sweeper, services, store
):
    radarr = services.radarr["meleys"]
    store.record_stall(
        host="meleys", kind="movie", item="movie:8", title="Dune (2021)", reason="stalled",
        action=StallAction.RESEARCHED,
    )  # fmt: skip
    stuck = [queued(5, "nzo_b", 6 * GB, tracked="warning")]
    radarr.queue_items = list(stuck)
    await sweeper()
    age(store, "meleys", "movie", "nzo_b", hours=7)
    assert len(await sweeper()) == 1
    radarr.queue_items = []  # one read that didn't list it
    await sweeper()
    radarr.queue_items = list(stuck)
    assert await sweeper() == []


async def test_a_removal_whose_search_doesnt_start_goes_to_the_admin(sweeper, services, store):
    radarr = services.radarr["meleys"]
    radarr.queue_items = [queued(1, "nzo_a", 6 * GB, tracked="warning")]
    await sweeper()
    age(store, "meleys", "movie", "nzo_a", hours=7)

    async def refuse(ids):
        raise ClientError("radarr", "POST", "/api/v3/command", 503, "busy")

    radarr.movies_search = refuse
    (post,) = await sweeper()
    assert radarr.removed == [1] and "search didn't start" in post.text
    assert "Search for it in Radarr on meleys" in post.text
    (removed,) = store.stalls_since(datetime.now(UTC) - timedelta(hours=1))
    assert removed.action == StallAction.REMOVED
    # It counts as cleared for a new release: stalling again surfaces it.
    assert store.researched_since("meleys", "movie", "movie:8", datetime.now(UTC) - timedelta(1))
