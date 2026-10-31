"""raven's client through respx, its fake, and the search_library, newest_in_library and
search_people tools."""

import pytest
import respx

from sparrow.agent.tools import Failed, Refused, Tier, Title, TitleLink, ToolContext
from sparrow.clients import ClientError, FakeRavenClient, RavenClient
from sparrow.clients.raven import Part, PersonMatch, RavenPerson, RavenTitle, Work, quality_of
from sparrow.config import Settings
from sparrow.memo import Memo
from sparrow.tools import raven as raven_tool
from sparrow.tools.raven import closeness, newest_in_library, search_library, search_people

BASE = "http://raven.test"
LIBRARIES = [
    {"id": 4, "name": "4K Movies", "settings": {"kind": "movies", "locked": False}},
    {"id": 6, "name": "Movies", "settings": {"kind": "movies", "locked": False}},
    {"id": 7, "name": "TV Shows", "settings": {"kind": "shows", "locked": False}},
    {"id": 8, "name": "UFC", "settings": {"kind": "sports", "locked": False}},
    {"id": 9, "name": "Private", "settings": {"kind": "movies", "locked": True}},
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


@respx.mock
async def test_newest_reads_each_unlocked_library_of_the_kind_by_release_date():
    respx.get(f"{BASE}/api/libraries").respond(json=LIBRARIES)
    movies = {
        4: [
            {
                "libraryId": 4,
                "title": "Dune",
                "width": 3840,
                "item": {"id": 277, "title": "Dune", "year": 2021, "released": "2021-10-22"},
            }
        ],
        6: [
            {
                "libraryId": 6,
                "title": "Arrival",
                "width": 1920,
                "item": {"id": 12, "title": "Arrival", "year": 2016, "released": "2016-11-11"},
            }
        ],
    }
    for library_id, listing in movies.items():
        respx.get(f"{BASE}/api/libraries/{library_id}/media", params={"sort": "year-new"}).respond(
            json=listing
        )
    shows = {
        "shows": [
            {
                "show": {
                    "id": 900,
                    "title": "Dune: Prophecy",
                    "year": 2024,
                    "released": "2024-11-17",
                },
                "episodes": 6,
            }
        ]
    }
    respx.get(f"{BASE}/api/libraries/7/shows", params={"sort": "year-new"}).respond(json=shows)
    dune, arrival = await RavenClient(BASE).newest("movie")
    assert (dune.library, dune.released) == ("4K Movies", "2021-10-22")
    assert (arrival.library, arrival.released) == ("Movies", "2016-11-11")
    (prophecy,) = await RavenClient(BASE).newest("show")
    assert prophecy.released == "2024-11-17" and prophecy.episodes == 6


async def test_newest_in_library_lists_released_titles_once_newest_first(services):
    raven = FakeRavenClient(
        titles=[
            RavenTitle(6, "Movies", "movie", "Not Out Yet", 2099, 1, released="2099-01-01"),
            RavenTitle(6, "Movies", "movie", "Arrival", 2016, 12, "1080p", released="2016-11-11"),
            RavenTitle(
                4, "4K Movies", "movie", "Dune", 2021, 277, "4K", True, released="2021-10-22"
            ),
            RavenTitle(6, "Movies", "movie", "Dune", 2021, 277, "1080p", released="2021-10-22"),
            RavenTitle(6, "Movies", "movie", "Undated", None, 5),
            RavenTitle(6, "Movies", "movie", "unmatched.mkv", None, None, released="2024-01-01"),
            RavenTitle(7, "TV Shows", "show", "Severance", 2022, 95396, released="2022-02-18"),
        ]
    )
    reply = await newest_in_library(ctx_with(services, raven), "movie")
    assert [t["title"] for t in reply.content["titles"]] == ["Dune", "Arrival"]
    assert reply.content["titles"][0] == {
        "title": "Dune",
        "year": 2021,
        "released": "2021-10-22",
        "libraries": ["4K Movies", "Movies"],
        "raven_link": "http://raven.test/movies/277?library=4",
    }
    assert [t.title for t in reply.titles] == ["Dune", "Arrival"]
    assert [link.label for link in reply.titles[0].links] == ["4K HDR", "1080p"]
    (latest,) = (await newest_in_library(ctx_with(services, raven), "movie", count=1)).content[
        "titles"
    ]
    assert latest["title"] == "Dune"
    shows = await newest_in_library(ctx_with(services, raven), "show")
    assert [t["title"] for t in shows.content["titles"]] == ["Severance"]


async def test_newest_in_library_says_when_raven_is_missing_or_down(services):
    reply = await newest_in_library(ctx_with(services, None), "movie")
    assert isinstance(reply, Refused) and "RAVEN_URL" in reply.content
    raven = FakeRavenClient()
    raven.down = True
    down = await newest_in_library(ctx_with(services, raven), "show")
    assert isinstance(down, Failed) and not down.retryable
    assert "Don't call newest_in_library again" in down.content


ODENKIRK_PAGE = {
    "id": 31,
    "tmdbId": "59410",
    "name": "Bob Odenkirk",
    "photoVersion": None,
    "profile": {"knownFor": "Acting", "biography": "An actor."},
    "filmography": {
        "state": "ready",
        "fetchedAt": "2026-10-30T12:00:00.000Z",
        "entries": [
            {
                "type": "movie",
                "tmdbId": "1007734",
                "title": "Nobody 2",
                "year": 2025,
                "released": "2025-08-15",
                "credits": [
                    {"department": "acting", "role": "Hutch", "episodes": None, "isSelf": False},
                    {
                        "department": "producing",
                        "role": "Producer",
                        "episodes": None,
                        "isSelf": False,
                    },
                ],
                "item": None,
            },
            {
                "type": "show",
                "tmdbId": "60059",
                "title": "Better Call Saul",
                "year": 2015,
                "released": "2015-02-08",
                "credits": [
                    {"department": "acting", "role": "Saul", "episodes": 63, "isSelf": False}
                ],
                "item": {"id": 70, "type": "show", "title": "Better Call Saul", "year": 2015},
            },
        ],
    },
    "credits": [
        {
            "item": {"id": 70, "type": "show", "title": "Better Call Saul", "year": 2015},
            "job": "cast",
            "role": "Saul",
        }
    ],
}


@respx.mock
async def test_people_and_a_persons_page_read_raven():
    respx.get(f"{BASE}/api/people", params={"q": "odenkirk"}).respond(
        json=[{"id": 31, "name": "Bob Odenkirk", "photoVersion": None, "titles": 1}]
    )
    respx.get(f"{BASE}/api/people/31").respond(json=ODENKIRK_PAGE)
    assert await RavenClient(BASE).people("odenkirk") == [PersonMatch(31, "Bob Odenkirk", 1)]
    person = await RavenClient(BASE).person(31)
    assert (person.name, person.known_for, person.complete) == ("Bob Odenkirk", "Acting", True)
    nobody, saul = person.works
    assert nobody.item_id is None and nobody.parts[1] == Part("producing", "Producer")
    assert saul.kind == "show" and saul.link(BASE) == f"{BASE}/shows/70"


@respx.mock
async def test_without_tmdb_a_persons_page_is_raven_credits_alone():
    page = {**ODENKIRK_PAGE, "profile": None, "filmography": {"state": "unavailable"}}
    respx.get(f"{BASE}/api/people/31").respond(json=page)
    person = await RavenClient(BASE).person(31)
    assert not person.complete and not person.pending and person.known_for is None
    assert person.works == (
        Work("show", "Better Call Saul", 2015, None, (Part("acting", "Saul"),), 70),
    )
    respx.get(f"{BASE}/api/people/32").respond(json={"id": 32})
    with pytest.raises(ClientError, match="unexpected body"):
        await RavenClient(BASE).person(32)


def odenkirk(**fields) -> RavenPerson:
    return RavenPerson(
        id=31,
        name="Bob Odenkirk",
        known_for="Acting",
        works=(
            Work("movie", "Untitled Project", None, None, (Part("acting"),)),
            Work("movie", "Nobody 3", 2099, "2099-01-01", (Part("acting", "Hutch"),)),
            Work("movie", "Nobody 2", 2025, "2025-08-15", (Part("acting", "Hutch"),)),
            Work("show", "Late Night", 2024, "2024-01-01", (Part("acting", "Self", True),)),
            Work("movie", "Nobody", 2021, "2021-03-26", (Part("acting", "Hutch"),), 12),
            Work("movie", "Melvin Goes to Dinner", 2003, "2003-01-01", (Part("directing"),), 13),
            Work("show", "Better Call Saul", 2015, "2015-02-08", (Part("acting", "Saul"),), 70),
        ),
        **({"complete": True} | fields),
    )


async def test_search_people_says_what_is_on_the_server_and_their_latest(services):
    raven = FakeRavenClient(
        persons=[odenkirk(), RavenPerson(32, "Bob Odenkirk Jr.", None, (), complete=True)]
    )
    reply = await search_people(ctx_with(services, raven), "bob odenkirk", kind="movie")
    content = reply.content
    assert content["person"] == "Bob Odenkirk"
    assert content["raven_link"] == "http://raven.test/people/31"
    assert [w["title"] for w in content["on_server"]] == ["Nobody", "Melvin Goes to Dinner"]
    assert content["on_server"][0] == {
        "title": "Nobody",
        "kind": "movie",
        "year": 2021,
        "released": "2021-03-26",
        "parts": [{"department": "acting", "role": "Hutch"}],
        "on_server": True,
        "raven_link": "http://raven.test/movies/12",
    }
    assert [(w["title"], w["on_server"]) for w in content["latest"]] == [
        ("Nobody 2", False),
        ("Nobody", True),
        ("Melvin Goes to Dinner", True),
    ]
    assert [w["title"] for w in content["upcoming"]] == ["Nobody 3"]
    assert "others_named_like_that" not in content
    assert [t.title for t in reply.titles] == ["Nobody", "Melvin Goes to Dinner"]
    assert reply.titles[0].links == (TitleLink("raven", "http://raven.test/movies/12"),)
    directing = await search_people(ctx_with(services, raven), "odenkirk", job="directing")
    assert [w["title"] for w in directing.content["latest"]] == ["Melvin Goes to Dinner"]
    # Appearing as himself on a talk show is no part in it.
    shows = await search_people(ctx_with(services, raven), "odenkirk", kind="show")
    assert [w["title"] for w in shows.content["latest"]] == ["Better Call Saul"]


async def test_search_people_asks_once_more_while_raven_fetches_the_filmography(
    services, monkeypatch
):
    monkeypatch.setattr(raven_tool, "FILMOGRAPHY_WAIT_S", 0)
    pages = [odenkirk(complete=False, pending=True), odenkirk(complete=False)]
    raven = FakeRavenClient(persons=[odenkirk()])

    async def person(person_id):
        return pages.pop(0)

    monkeypatch.setattr(raven, "person", person)
    reply = await search_people(ctx_with(services, raven), "odenkirk")
    assert pages == [] and "latest" not in reply.content
    assert "couldn't read their TMDB filmography" in reply.content["note"]


async def test_search_people_names_the_others_when_the_name_is_not_exact(services):
    other = RavenPerson(
        32,
        "Bob Odenkirk Jr.",
        None,
        (Work("movie", "X", None, None, (Part("acting"),), 5),),
        complete=True,
    )
    raven = FakeRavenClient(persons=[odenkirk(), other])
    reply = await search_people(ctx_with(services, raven), "odenkirk")
    assert reply.content["others_named_like_that"] == [
        {"name": "Bob Odenkirk Jr.", "titles_on_server": 1}
    ]
    assert "ask which" in reply.content["note"]


async def test_search_people_says_no_one_is_found_and_when_raven_is_down(services):
    reply = await search_people(ctx_with(services, FakeRavenClient()), "Bob Odenkirk")
    assert reply.content["people"] == [] and reply.titles == ()
    assert "No one by that name" in reply.content["note"]
    assert isinstance(await search_people(ctx_with(services, None), "Bob"), Refused)
    raven = FakeRavenClient()
    raven.down = True
    down = await search_people(ctx_with(services, raven), "Bob")
    assert isinstance(down, Failed) and "Don't call search_people again" in down.content
