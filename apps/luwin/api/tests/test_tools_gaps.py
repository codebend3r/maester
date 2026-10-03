from datetime import UTC, datetime, timedelta

import pytest

from luwin.agent.tools import Result, registry
from luwin.clients.sonarr import Episode
from luwin.tools.gaps import find_gaps, gaps_in
from tests.playback_world import stock

NOW = datetime(2026, 9, 27, tzinfo=UTC)
AIRED, FUTURE = NOW - timedelta(days=400), NOW + timedelta(days=30)


def episode(id, season, number, *, has_file=True, monitored=True, aired=AIRED):
    return Episode(id, 12, season, number, "", has_file, id if has_file else None, monitored, aired)


BEAR_EPISODES = [
    episode(1, 0, 1, has_file=False),  # a special
    episode(11, 1, 1),
    episode(12, 1, 2),
    episode(21, 2, 6),
    episode(22, 2, 7, has_file=False),
    episode(23, 2, 8, has_file=False, monitored=False),
    episode(31, 3, 1, has_file=False),
    episode(32, 3, 2, has_file=False),
    episode(41, 4, 1, has_file=False, aired=FUTURE),
    episode(42, 4, 2, has_file=False, aired=None),
]


def test_gaps_are_aired_episodes_without_files_and_whole_seasons_stand_apart():
    found = gaps_in(BEAR_EPISODES, NOW)
    assert [e.id for e in found.scattered] == [22]
    assert found.whole_seasons == {3: 2}
    assert [e.id for e in found.unmonitored] == [23]
    only_two = gaps_in(BEAR_EPISODES, NOW, season=2)
    assert only_two.whole_seasons == {} and [e.id for e in only_two.scattered] == [22]


@pytest.fixture
def bear(ctx):
    stock(ctx)
    ctx.services.sonarr["meleys"].episode_list = BEAR_EPISODES
    return ctx


async def test_find_gaps_searches_the_scattered_ones_and_tells_the_admin_about_whole_seasons(bear):
    out = await find_gaps(bear, 136315, "Meleys")
    assert isinstance(out, Result)
    assert out.content["searched"] == ["S02E07"] and out.content["not_monitored"] == ["S02E08"]
    assert out.content["whole_seasons_missing"] == [{"season": 3, "aired_episodes": 2}]
    assert bear.services.sonarr["meleys"].searched == [[22]]
    (notice,) = out.notices
    assert notice.text.startswith("dany says The Bear (2022) is missing episodes on meleys.")
    assert "None of season 3 (2 aired) is there, so it wasn't searched" in notice.text


async def test_find_gaps_for_one_season_or_a_complete_show(bear):
    out = await find_gaps(bear, 136315, "meleys", season=2)
    assert out == {
        "title": "The Bear (2022)",
        "host": "meleys",
        "searched": ["S02E07"],
        "note": "Searching for the missing episodes; they usually land within a few hours.",
        "not_monitored": ["S02E08"],
    }
    out = await find_gaps(bear, 136315, "meleys", season=1)
    assert out["searched"] == [] and out["note"] == "Every episode that has aired is on the server."
    assert bear.services.sonarr["meleys"].searched == [[22]]  # nothing searched the second time


async def test_find_gaps_only_on_the_owning_host(bear):
    out = await find_gaps(bear, 136315, "vermithor")
    assert out == Result.refusal("The Bear (2022) is on the Sonarr on meleys, not vermithor.")
    assert registry.get("find_gaps").host_param == "host"
