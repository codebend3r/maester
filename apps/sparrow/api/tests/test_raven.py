"""raven's client through respx, its fake, and the search_library tool."""

import pytest
import respx

from sparrow.agent.tools import Failed, Refused, Tier, Title, TitleLink, ToolContext
from sparrow.clients import ClientError, FakeRavenClient, RavenClient
from sparrow.clients.raven import RavenTitle, quality_of
from sparrow.config import Settings
from sparrow.memo import Memo
from sparrow.tools import raven as raven_tool
from sparrow.tools.raven import closeness, search_library

BASE = "http://raven.test"
LIBRARIES = [
    {"id": 4, "name": "4K Movies"},
    {"id": 6, "name": "Movies"},
    {"id": 7, "name": "TV Shows"},
]
SEARCH = [
    {
        "libraryId": 4,
        "type": "media",
        "media": [
            {
                "libraryId": 4,
                "title": "Dune Part One",
                "year": 2021,
                "width": 3840,
                "height": 1606,
                "hdr": True,
                "versions": 2,
                "item": {"id": 277, "type": "movie", "title": "Dune", "year": 2021},
            },
            {"libraryId": 4, "title": "dune.fanedit", "width": 1920, "item": None},
        ],
    },
    {
        "libraryId": 7,
        "type": "shows",
        "shows": [{"show": {"id": 900, "title": "Dune: Prophecy", "year": 2024}, "episodes": 6}],
    },
]


@respx.mock
async def test_search_reads_every_library_with_its_name():
    respx.get(f"{BASE}/api/home/search", params={"q": "dune"}).respond(json=SEARCH)
    respx.get(f"{BASE}/api/libraries").respond(json=LIBRARIES)
    movie, unmatched, show = await RavenClient(BASE).search("dune")
    assert movie == RavenTitle(4, "4K Movies", "movie", "Dune", 2021, 277, "4K", True, 2)
    assert movie.link(BASE) == f"{BASE}/movies/277?library=4"
    assert unmatched.item_id is None and unmatched.link(BASE) is None
    assert unmatched.title == "dune.fanedit" and unmatched.quality == "1080p"
    assert show.kind == "show" and show.library == "TV Shows" and show.episodes == 6
    assert show.link(BASE) == f"{BASE}/shows/900?library=7"


@respx.mock
async def test_an_unexpected_answer_is_a_client_error():
    respx.get(f"{BASE}/api/home/search").respond(json=[{"type": "media"}])
    respx.get(f"{BASE}/api/libraries").respond(json=LIBRARIES)
    with pytest.raises(ClientError, match="unexpected body"):
        await RavenClient(BASE).search("dune")


def test_quality_follows_the_width_release_names_go_by():
    assert [quality_of(w) for w in (3840, 1920, 1280, 720, None)] == [
        "4K",
        "1080p",
        "720p",
        "SD",
        None,
    ]


def ctx_with(services, raven):
    services.raven = raven
    return ToolContext("d1", Tier.FRIEND, services, None, Settings(), Memo())


async def test_search_library_answers_with_each_copy_and_its_link(services):
    raven = FakeRavenClient(
        titles=[
            RavenTitle(4, "4K Movies", "movie", "Dune", 2021, 277, "4K", True, 2),
            RavenTitle(6, "Movies", "movie", "Dune", 2021, 277, "1080p"),
            RavenTitle(6, "Movies", "movie", "Arrival", 2016, 12, "1080p"),
        ]
    )
    reply = await search_library(ctx_with(services, raven), "dune")
    assert reply.content == {
        "query": "dune",
        "matches": [
            {
                "title": "Dune",
                "year": 2021,
                "kind": "movie",
                "library": "4K Movies",
                "quality": "4K",
                "hdr": True,
                "versions": 2,
                "raven_link": "http://raven.test/movies/277?library=4",
            },
            {
                "title": "Dune",
                "year": 2021,
                "kind": "movie",
                "library": "Movies",
                "quality": "1080p",
                "raven_link": "http://raven.test/movies/277?library=6",
            },
        ],
    }
    (dune,) = reply.titles
    assert dune == Title(
        key="raven:movie:277",
        title="Dune",
        year=2021,
        logo_url="http://raven.test/api/items/277/images/logo",
        links=(
            TitleLink("4K HDR", "http://raven.test/movies/277?library=4"),
            TitleLink("1080p", "http://raven.test/movies/277?library=6"),
        ),
    )
    missing = await search_library(ctx_with(services, raven), "Heat")
    assert missing.content["matches"] == [] and missing.titles == ()
    assert "isn't on the server" in missing.content["note"]


async def test_search_library_refuses_without_raven(services):
    reply = await search_library(ctx_with(services, None), "dune")
    assert isinstance(reply, Refused) and "RAVEN_URL" in reply.content


async def test_a_plural_finds_what_the_singular_does(services):
    raven = FakeRavenClient(titles=[RavenTitle(4, "4K Movies", "movie", "The Terminator", 1984, 9)])
    reply = await search_library(ctx_with(services, raven), "Terminators")
    assert [m["title"] for m in reply.content["matches"]] == ["The Terminator"]


async def test_an_unreachable_raven_is_said_once_not_retried(services):
    raven = FakeRavenClient()
    raven.down = True
    reply = await search_library(ctx_with(services, raven), "Dune")
    assert isinstance(reply, Failed) and not reply.retryable
    assert "raven at http://raven.test isn't answering" in reply.content
    assert "Don't call search_library again" in reply.content


async def test_the_title_itself_comes_first_and_alone_on_the_cards(services, monkeypatch):
    monkeypatch.setattr(raven_tool, "MAX_MATCHES", 2)
    titles = [RavenTitle(4, "Movies", "movie", f"Lighthouse {n}", 2019, n) for n in range(3)]
    titles += [
        RavenTitle(7, "TV Shows", "show", "House of Cards", 2013, 55834),
        RavenTitle(7, "TV Shows", "show", "House", 2004, 15266, episodes=177),
        RavenTitle(4, "Movies", "movie", "Road House", 1989, 5386),
    ]
    reply = await search_library(ctx_with(services, FakeRavenClient(titles=titles)), "house")
    assert [m["title"] for m in reply.content["matches"]] == ["House", "House of Cards"]
    assert [t.title for t in reply.titles] == ["House"]
    assert reply.titles[0].links[0].url == "http://raven.test/shows/15266?library=7"


def test_closeness_ranks_the_title_its_prefix_its_word_then_any_match():
    def title(name):
        return RavenTitle(1, "Movies", "movie", name, None, 1)

    assert [
        closeness(title(t), "House")
        for t in ("The House", "House of Gucci", "Road House", "Grindhouse")
    ] == [0, 1, 2, 3]
