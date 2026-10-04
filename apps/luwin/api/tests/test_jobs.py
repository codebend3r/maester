from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from luwin.jobs import At, Every, Job, Scheduler
from luwin.notify import AdminPost

TORONTO = ZoneInfo("America/Toronto")


def local(*args) -> datetime:
    return datetime(*args, tzinfo=TORONTO)


def test_a_daily_slot_is_the_wall_clock_time_in_the_server_zone():
    daily = At(time(8, 0), TORONTO)
    assert daily.next(local(2026, 3, 7, 9, 0)) == local(2026, 3, 8, 8, 0)
    assert daily.last(local(2026, 3, 7, 9, 0)) == local(2026, 3, 7, 8, 0)
    assert daily.last(local(2026, 3, 7, 8, 0)) == local(2026, 3, 7, 8, 0)
    # Across the spring-forward night, 8:00 is still 8:00 local, 23 hours later.
    after = daily.next(local(2026, 3, 7, 8, 0))
    assert after - local(2026, 3, 7, 8, 0) == timedelta(hours=23)


def test_a_weekly_slot_falls_on_its_day():
    mondays = At(time(8, 0), TORONTO, weekday=0)
    wednesday = local(2026, 9, 30, 12, 0)
    assert mondays.next(wednesday) == local(2026, 10, 5, 8, 0)
    assert mondays.last(wednesday) == local(2026, 9, 28, 8, 0)


class Stop(Exception):
    pass


class Clock:
    """A wall clock that only moves when the scheduler sleeps."""

    def __init__(self, start: datetime, sleeps: int):
        self.now, self.left, self.slept = start, sleeps, []

    def __call__(self) -> datetime:
        return self.now

    async def sleep(self, seconds: float) -> None:
        if not self.left:
            raise Stop
        self.left -= 1
        self.slept.append(seconds)
        self.now += timedelta(seconds=seconds)


class Inbox:
    def __init__(self):
        self.delivered = []

    async def deliver(self, notices):
        self.delivered.extend(notices)
        return []


def scheduler(store, clock, *jobs):
    inbox = Inbox()
    return Scheduler(jobs, store=store, notifier=inbox, clock=clock, sleep=clock.sleep), inbox


def counting(name, when, runs):
    async def run():
        runs.append(name)
        return [AdminPost(f"{name} #{len(runs)}")]

    return Job(name, when, run)


async def test_a_daily_job_catches_up_on_a_recent_missed_slot_then_runs_each_day(store):
    runs = []
    clock = Clock(local(2026, 9, 28, 10, 0), sleeps=2)
    jobs, inbox = scheduler(store, clock, counting("digest", At(time(8, 0), TORONTO), runs))
    with pytest.raises(Stop):
        await jobs.run()
    assert runs == ["digest"] * 3  # today's 8:00, missed while down, then two more days
    assert clock.slept == [22 * 3600, 24 * 3600]
    assert [n.text for n in inbox.delivered] == ["digest #1", "digest #2", "digest #3"]


async def test_a_restart_never_runs_a_slot_twice_and_skips_an_old_missed_one(store):
    runs = []
    daily = At(time(8, 0), TORONTO)
    for start in (local(2026, 9, 28, 9, 0), local(2026, 9, 28, 11, 0)):
        jobs, _ = scheduler(store, Clock(start, sleeps=0), counting("digest", daily, runs))
        with pytest.raises(Stop):
            await jobs.run()
    assert runs == ["digest"]
    stale = Clock(local(2026, 9, 28, 20, 0), sleeps=0)
    jobs, _ = scheduler(store, stale, counting("report", daily, runs))
    with pytest.raises(Stop):
        await jobs.run()
    assert runs == ["digest"]  # 8:00 was twelve hours ago: past the catch-up


async def test_a_job_every_so_often_runs_after_each_interval(store):
    runs = []
    clock = Clock(datetime(2026, 9, 28, tzinfo=UTC), sleeps=3)
    jobs, _ = scheduler(store, clock, counting("sweep", Every(timedelta(minutes=15)), runs))
    with pytest.raises(Stop):
        await jobs.run()
    assert runs == ["sweep"] * 3 and clock.slept == [900.0] * 3


async def test_a_failing_job_is_logged_and_the_next_one_still_runs(store, caplog):
    async def broken():
        raise RuntimeError("seerr down")

    clock = Clock(datetime(2026, 9, 28, tzinfo=UTC), sleeps=2)
    jobs, inbox = scheduler(store, clock, Job("sweep", Every(timedelta(minutes=1)), broken))
    with pytest.raises(Stop):
        await jobs.run()
    assert inbox.delivered == [] and caplog.text.count("job sweep failed") == 2
