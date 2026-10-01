from maester.agent.tools import Choices
from maester.clients.seerr import MediaStatus, SearchResult
from maester.tools.search import SEARCH_PICKS, search_media

UNKNOWN, AVAILABLE, PENDING = MediaStatus.UNKNOWN, MediaStatus.AVAILABLE, MediaStatus.PENDING


def result(tmdb_id, title, year, media_type="movie", status=UNKNOWN, status_4k=UNKNOWN):
    return SearchResult(
        tmdb_id, media_type, title, year, f"About {title}", "/p.jpg", status, status_4k
    )


async def test_several_exact_matches_become_a_labeled_picker(ctx):
    ctx.services.seerr.results = [
        result(438631, "Dune", 2021, status=AVAILABLE),
        result(841, "Dune", 1984, status=PENDING),
        result(693134, "Dune: Part Two", 2024),
        result(90228, "Dune", 2000, media_type="tv"),
    ]
    out = await search_media(ctx, "dune")
    assert isinstance(out, Choices)
    assert [(c.label, c.value, c.year) for c in out.items] == [
        ("Dune", "movie:438631", 2021),
        ("Dune", "movie:841", 1984),
        ("Dune", "tv:90228", 2000),
    ]
    assert out.items[0].detail.startswith("Movie · on the server")
    assert out.items[1].detail.startswith("Movie · requested, waiting for approval")
    assert out.items[2].detail.startswith("TV show · not on the server")
    assert out.items[0].poster_url == "https://image.tmdb.org/t/p/w185/p.jpg"
    assert "About Dune" in out.as_content()["choices"][0]["detail"]


async def test_one_plausible_match_comes_back_as_data(ctx):
    ctx.services.seerr.results = [
        result(438631, "Dune", 2021, status=AVAILABLE, status_4k=PENDING),
        result(693134, "Dune: Part Two", 2024),
    ]
    out = await search_media(ctx, "Dune: Part Two")
    assert out["match"]["tmdb_id"] == 693134 and out["match"]["media_type"] == "movie"
    out = await search_media(ctx, "dune", year=2021)
    assert out["match"]["availability"] == "on the server; 4K requested, waiting for approval"
    assert set(out["match"]) == {
        "tmdb_id", "media_type", "title", "year", "overview", "poster_url", "availability"
    }  # fmt: skip


async def test_no_exact_match_offers_what_search_found(ctx):
    ctx.services.seerr.results = [result(i, f"Heist {i}", 2000 + i) for i in range(8)]
    out = await search_media(ctx, "heist")
    assert isinstance(out, Choices) and len(out.items) == SEARCH_PICKS


async def test_filters_and_nothing_found(ctx):
    ctx.services.seerr.results = [result(1, "Dune", 2021), result(2, "Dune", 2000, "tv")]
    assert (await search_media(ctx, "dune", media_type="tv"))["match"]["tmdb_id"] == 2
    assert (await search_media(ctx, "nothing like it"))["results"] == []
