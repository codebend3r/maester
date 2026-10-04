import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from luwin.memo import Key, Memo

MINUTE = timedelta(minutes=1)
COUNT: Key[int] = Key("count")
ANSWER: Key[str] = Key("answer")


class Clock:
    def __init__(self):
        self.now = datetime(2026, 9, 27, 10, 0, tzinfo=UTC)

    def __call__(self):
        return self.now


async def test_an_answer_is_reused_while_fresh_and_fetched_again_after():
    clock, calls = Clock(), []

    async def fetch():
        calls.append(clock.now)
        return len(calls)

    memo = Memo(clock)
    assert (await memo.fresh(COUNT, MINUTE, fetch)).value == 1
    clock.now += timedelta(seconds=59)
    assert (await memo.fresh(COUNT, MINUTE, fetch)).value == 1
    assert memo.age(memo.latest(COUNT)) == timedelta(seconds=59)
    clock.now += timedelta(seconds=1)
    kept = await memo.fresh(COUNT, MINUTE, fetch)
    assert (kept.value, kept.at, len(calls)) == (2, clock.now, 2)
    assert memo.latest(ANSWER) is None


async def test_callers_asking_at_once_share_one_fetch():
    started, release, calls = asyncio.Event(), asyncio.Event(), []

    async def slow():
        calls.append(1)
        started.set()
        await release.wait()
        return "answer"

    memo = Memo()
    first = asyncio.create_task(memo.fresh(ANSWER, MINUTE, slow))
    await started.wait()
    second = asyncio.create_task(memo.fresh(ANSWER, MINUTE, slow))
    release.set()
    assert [k.value for k in await asyncio.gather(first, second)] == ["answer", "answer"]
    assert calls == [1]


async def test_a_fetch_that_raises_keeps_nothing():
    async def broken():
        raise RuntimeError("down")

    memo = Memo()
    with pytest.raises(RuntimeError):
        await memo.fresh(ANSWER, MINUTE, broken)
    assert memo.latest(ANSWER) is None
