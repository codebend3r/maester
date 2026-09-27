import time
from dataclasses import replace

import pytest

from maester.agent.tools import Choices
from maester.clients.plex import PlexItem
from maester.clients.seerr import MediaDetails, MediaStatus
from maester.playback.items import Item
from maester.playback.plays import copy_of, recent_plays
from maester.tools.playback import recent_sessions
from tests.factories import history_row, session

S = MediaStatus
DANY = 8008135
DUNE = MediaDetails(
    438631, "movie", "Dune", 2021, "", S.AVAILABLE, S.AVAILABLE,
    rating_key="4348", rating_key_4k="9001",
)  # fmt: skip
BEAR = MediaDetails(136315, "tv", "The Bear", 2022, "", S.AVAILABLE, S.UNKNOWN, rating_key="5120")


class Down:
    async def activity(self):
        raise ConnectionError("tautulli is down")

    async def history(self, **kw):
        raise ConnectionError("tautulli is down")


@pytest.fixture
def watching(ctx):
    """Dany plays Dune in 4K on meleys now; The Bear S02E07 finished two hours ago."""
    ctx.store.upsert_user("d1", tautulli_user_id=DANY)
    services = ctx.services
    services.seerr.details.update({("movie", 438631): DUNE, ("tv", 136315): BEAR})
    services.plex.items.update(
        {
            "9001": PlexItem("9001", "Dune", "movie", 2021, ("tmdb://438631",), ()),
            "5120": PlexItem("5120", "The Bear", "show", 2022, ("tmdb://136315",), ()),
        }
    )
    meleys = services.tautulli["meleys"]
    meleys.sessions = [
        session(user_id=DANY, rating_key="9001", full_title="Dune", product="Plex for Roku",
                player="Living Room"),
        session(user_id=42, rating_key="777", full_title="Someone else's"),
    ]  # fmt: skip
    two_hours_ago = int(time.time()) - 7200
    meleys.history_rows = [
        history_row(user_id=DANY, rating_key="5188", full_title="The Bear - Forks",
                    media_type="episode", show_key="5120", season=2, episode=7,
                    started=two_hours_ago, product="Plex Web", player="Chrome", row_id=1124),
        # Plex no longer knows this one, so it can't be offered.
        history_row(user_id=DANY, rating_key="31337", full_title="Gone", started=two_hours_ago - 60),
    ]  # fmt: skip
    return ctx


async def test_recent_sessions_offers_each_play_as_its_copy_and_episode(watching):
    watching.services.tautulli["vermithor"] = Down()
    picker = await recent_sessions(watching)
    assert isinstance(picker, Choices)
    dune, bear = picker.items
    assert (dune.label, dune.value) == ("Dune (2021)", "movie:438631:4K")
    assert dune.detail == "4K · playing now · Plex for Roku on Living Room"
    assert (bear.label, bear.value) == ("The Bear (2022) S02E07", "tv:136315:1080p:S02E07")
    assert bear.detail == "1080p · about 2 h ago · Plex Web on Chrome"


async def test_recent_sessions_without_plays_or_a_tautulli_match_points_to_search(watching):
    services = watching.services
    services.tautulli["meleys"].sessions, services.tautulli["meleys"].history_rows = [], []
    services.tautulli["vermithor"] = Down()
    out = await recent_sessions(watching)
    assert out["sessions"] == [] and "search_media" in out["note"]
    assert out["unreachable"] == {"vermithor": "ConnectionError: tautulli is down"}

    watching.store.upsert_user("d1", tautulli_user_id=None)
    out = await recent_sessions(watching)
    assert "isn't matched to a Tautulli user" in out["note"]


async def test_plays_are_live_first_then_newest_and_one_per_plex_item(watching):
    services = watching.services
    # The other host logged the same Plex item too.
    services.tautulli["vermithor"].history_rows = [
        history_row(user_id=DANY, rating_key="5188", show_key="5120", season=2, episode=7,
                    media_type="episode", started=1)
    ]  # fmt: skip
    found = await recent_plays(services, DANY)
    assert [(p.host, p.rating_key, p.kind) for p in found.plays] == [
        ("meleys", "9001", "movie"),
        ("meleys", "5188", "tv"),
        ("meleys", "31337", "movie"),
    ]
    live, bear, _ = found.plays
    assert live.live and live.plex_key == "9001" and bear.plex_key == "5120"
    assert bear.is_of(BEAR, Item("tv", 136315, False, 2, 7))
    assert not bear.is_of(BEAR, Item("tv", 136315, False, 2, 8))
    assert live.is_of(DUNE, Item("movie", 438631, True))
    assert not live.is_of(DUNE, Item("movie", 438631, False))


def test_which_copy_a_plex_item_is():
    assert copy_of(DUNE, "9001") is True and copy_of(DUNE, "4348") is False
    assert copy_of(DUNE, "1") is None
    assert copy_of(replace(DUNE, rating_key_4k="4348"), "4348") is None  # one item, both copies


def test_items_name_their_copy_and_episode():
    assert Item.of("tv", 136315, "4k", 2, 7).ref == "tv:136315:4K:S02E07"
    assert Item.of("movie", 438631, "1080p").title(DUNE) == "Dune (2021)"
    with pytest.raises(ValueError, match="season and the episode"):
        Item("tv", 136315, False, 2)
    with pytest.raises(ValueError, match="no season"):
        Item("movie", 438631, False, 1, 1)
