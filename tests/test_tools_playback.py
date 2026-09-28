import time
from dataclasses import replace

import pytest

from maester.agent.tools import Choices, Result
from maester.clients import FakeTautulliClient
from maester.library import NotLocated
from maester.media import Copy
from maester.playback.items import locate
from maester.playback.plays import copy_of, recent_plays
from maester.tools.playback import NOTHING_RECENT, list_tracks, recent_sessions
from tests.factories import history_row, session
from tests.playback_world import BEAR, DANY, DUNE, FORKS, stock


@pytest.fixture
def library(ctx):
    return stock(ctx)


class Down:
    async def activity(self):
        raise ConnectionError("tautulli is down")

    async def history(self, **kw):
        raise ConnectionError("tautulli is down")


@pytest.fixture
def watching(library):
    """Dany plays Dune in 4K on meleys now; The Bear S02E07 finished two hours ago."""
    meleys = library.services.tautulli["meleys"]
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
    return library


async def test_recent_sessions_offers_each_play_as_its_copy_and_episode(watching):
    watching.services.tautulli["vermithor"] = Down()
    picker = await recent_sessions(watching)
    assert isinstance(picker, Choices)
    dune, bear = picker.items
    assert (dune.label, dune.value) == ("Dune (2021)", "movie:438631:4K")
    assert dune.detail == "4K · playing now · Plex for Roku on Living Room"
    assert (bear.label, bear.value) == ("The Bear (2022) S02E07", "tv:136315:1080p:S02E07")
    assert bear.detail == "1080p · about 2 h ago · Plex Web on Chrome"
    # What couldn't be looked up is said, not hidden behind "nothing recent".
    assert picker.notes == (
        "couldn't reach Tautulli on vermithor: ConnectionError: tautulli is down",
        "couldn't tell what Gone is: Plex has no TMDB id for Gone",
    )
    assert picker.as_content()["notes"] == list(picker.notes)


async def test_recent_sessions_without_plays_or_a_tautulli_match_points_to_search(watching):
    services = watching.services
    services.tautulli["meleys"].sessions, services.tautulli["meleys"].history_rows = [], []
    services.tautulli["vermithor"] = Down()
    out = await recent_sessions(watching)
    assert out["sessions"] == [] and "search_media" in out["note"]
    assert out["notes"] == [
        "couldn't reach Tautulli on vermithor: ConnectionError: tautulli is down"
    ]
    services.tautulli["vermithor"] = FakeTautulliClient(host="vermithor")
    assert await recent_sessions(watching) == {"sessions": [], "note": NOTHING_RECENT}

    watching.store.upsert_user("d1", tautulli_user_id=None)
    out = await recent_sessions(watching)
    assert out.is_error and "isn't matched to a Tautulli user" in out.content


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
    assert bear.is_of(BEAR, Copy("tv", 136315, False, 2, 7))
    assert not bear.is_of(BEAR, Copy("tv", 136315, False, 2, 8))
    assert live.is_of(DUNE, Copy("movie", 438631, True))
    assert not live.is_of(DUNE, Copy("movie", 438631, False))


def test_which_copy_a_plex_item_is():
    assert copy_of(DUNE, "9001") is True and copy_of(DUNE, "4348") is False
    assert copy_of(DUNE, "1") is None
    assert copy_of(replace(DUNE, rating_key_4k="4348"), "4348") is None  # one item, both copies


def test_a_copy_names_its_version_and_episode():
    assert Copy.of("tv", 136315, "4k", 2, 7).ref == "tv:136315:4K:S02E07"
    assert Copy.of("movie", 438631, "1080p").title(DUNE.display) == "Dune (2021)"
    assert Copy("tv", 136315, False).ref == "tv:136315:1080p"  # a whole show
    with pytest.raises(ValueError, match="season and the episode"):
        Copy("tv", 136315, False, 2)
    with pytest.raises(ValueError, match="no season"):
        Copy("movie", 438631, False, 1, 1)


async def test_locate_finds_a_copys_file_through_its_owning_arr(library):
    dune = await locate(library.services, Copy("movie", 438631, True))
    assert (dune.owner.host, dune.file.id, dune.label) == (
        "vermithor", 55, "the 4K copy of Dune (2021)",
    )  # fmt: skip
    forks = await locate(library.services, Copy("tv", 136315, False, 2, 7))
    assert (forks.owner.host, forks.file.path, forks.search_ids) == ("meleys", FORKS, (702,))
    assert forks.title == "The Bear (2022) S02E07"

    for copy, why in (
        (Copy("movie", 438631, False), "has no 1080p file on meleys"),
        (Copy("tv", 136315, False, 2, 8), "S02E08 has no file on meleys"),
        (Copy("tv", 136315, False, 9, 1), "has no S09E01 of The Bear"),
        (Copy("tv", 136315, False), "name the episode of The Bear"),
        (Copy("tv", 136315, True, 2, 7), "The 4K copy of The Bear \\(2022\\) isn't in Sonarr yet"),
    ):
        with pytest.raises(NotLocated, match=why):
            await locate(library.services, copy)


async def test_list_tracks_reads_the_files_own_tracks(library):
    out = await list_tracks(library, 438631, "movie", "4K")
    assert out["title"] == "Dune (2021)" and out["version"] == "4K"
    assert out["audio"] == [
        {"language": "eng", "codec": "truehd", "title": "TrueHD Atmos 7.1", "channels": 8,
         "english": True, "flags": ["default"]},
        {"language": "und", "codec": "ac3", "title": "English Dub", "channels": 6, "english": True},
    ]  # fmt: skip
    assert out["subtitles"] == [
        {"language": "eng", "codec": "hdmv_pgs_subtitle"},
        {"language": "es", "codec": "srt", "title": "Dune.es.forced.srt", "flags": ["forced", "file"]},
    ]  # fmt: skip


async def test_list_tracks_says_why_when_it_cannot(library):
    library.services.probe.files.pop(FORKS)
    out = await list_tracks(library, 136315, "tv", "1080p", 2, 7)
    assert out.is_error and out.content.startswith("The file couldn't be read: unreadable: ")
    out = await list_tracks(library, 136315, "tv", "1080p", 2, 8)
    assert out == Result.refusal("The Bear (2022) S02E08 has no file on meleys")
    out = await list_tracks(library, 438631, "movie", "4K", 1, 1)
    assert out == Result.refusal("a movie has no season or episode")
