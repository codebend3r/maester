from dataclasses import replace

import pytest

from maester.clients.arr import MediaFile
from maester.clients.radarr import Movie
from maester.clients.seerr import ArrRef, MediaDetails, MediaStatus
from maester.clients.sonarr import Series
from maester.library import Library, OwnerUnknown
from tests.factories import seerr_server

S = MediaStatus
DUNE = MediaDetails(438631, "movie", "Dune", 2021, "", S.AVAILABLE, S.AVAILABLE)
BEAR = MediaDetails(136315, "tv", "The Bear", 2022, "", S.AVAILABLE, S.UNKNOWN, tvdb_id=403245)


def dune(movie_id=8):
    return Movie(movie_id, "Dune", 438631, 2021, "/Movies/Dune (2021)", True, True, 55)


@pytest.fixture
def two_stacks(services):
    """Seerr sends 1080p to meleys and 4K to vermithor, for movies and shows alike."""
    services.seerr.arr_servers = {
        "radarr": [seerr_server(0, "movie", "meleys"), seerr_server(1, "movie", "vermithor", is_4k=True)],
        "sonarr": [seerr_server(0, "tv", "meleys"), seerr_server(1, "tv", "vermithor", is_4k=True)],
    }  # fmt: skip
    return services


async def owner(services, details, is_4k=False):
    return await (await Library.load(services)).owner(details, is_4k=is_4k)


async def test_each_copy_resolves_through_seerr_to_its_own_host(two_stacks):
    # Seerr's record says: standard copy is movie 8 on server 0, 4K copy is movie 31 on server 1.
    both = replace(DUNE, arr=ArrRef(0, 8), arr_4k=ArrRef(1, 31))
    standard, uhd = await owner(two_stacks, both), await owner(two_stacks, both, is_4k=True)
    assert (standard.host, standard.kind, standard.media_id) == ("meleys", "movie", 8)
    assert (uhd.host, uhd.media_id) == ("vermithor", 31)
    assert uhd.arr is two_stacks.radarr["vermithor"]


async def test_a_copy_seerr_never_sent_has_no_4k_owner_and_is_asked_for_by_id(two_stacks):
    assert await owner(two_stacks, DUNE, is_4k=True) is None
    assert await owner(two_stacks, DUNE) is None
    # Added straight to the 4K Radarr: not the standard copy, so not found.
    two_stacks.radarr["vermithor"].movie_list = [dune(31)]
    assert await owner(two_stacks, DUNE) is None
    two_stacks.radarr["meleys"].movie_list = [dune(8)]
    found = await owner(two_stacks, DUNE)
    assert (found.host, found.media_id) == ("meleys", 8)


async def test_shows_and_their_files(two_stacks):
    sonarr = two_stacks.sonarr["meleys"]
    sonarr.series_list = [
        Series(12, "The Bear", 403245, 2022, "/TV/The Bear", True, "standard", (1,))
    ]
    sonarr.files = [MediaFile(1, "/TV/The Bear/S01E01.mkv", 2_000, "WEBDL-1080p", None, 12, 1)]
    found = await owner(two_stacks, BEAR)
    assert (found.host, found.kind, found.media_id) == ("meleys", "tv", 12)
    assert [f.size_bytes for f in await found.files()] == [2_000]
    assert await owner(two_stacks, replace(BEAR, tvdb_id=None)) is None


async def test_what_cannot_be_settled_is_refused_never_guessed(services):
    services.radarr["meleys"].movie_list = [dune()]
    services.radarr["vermithor"].movie_list = [dune()]
    with pytest.raises(OwnerUnknown, match="meleys and vermithor both have it"):
        await owner(services, DUNE)

    services.seerr.arr_servers["radarr"] = [
        replace(seerr_server(0, "movie", "meleys"), url="http://radarr:7878")
    ]
    with pytest.raises(OwnerUnknown, match=r"\(http://radarr:7878\) matches no configured"):
        await owner(services, replace(DUNE, arr=ArrRef(0, 8)))
    with pytest.raises(OwnerUnknown, match="no longer lists"):
        await owner(services, replace(DUNE, arr=ArrRef(5, 8)))


async def test_an_instance_that_cannot_answer_is_refused(services):
    class Down:
        base_url = "http://meleys.lan:7878"

        async def movie_by_tmdb(self, tmdb_id):
            raise ConnectionError("meleys is down")

    services.radarr["meleys"] = Down()
    services.radarr["vermithor"].movie_list = [dune()]
    with pytest.raises(OwnerUnknown, match="couldn't ask the movie arr on meleys"):
        await owner(services, DUNE)
