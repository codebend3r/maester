import pytest

from maester.clients.radarr import Movie
from maester.library import AmbiguousOwner, movie_owner


def dune(path="/Movies/Dune (2021)"):
    return Movie(8, "Dune", 438631, 2021, path, True, True, 55)


async def test_movie_owner_is_the_one_instance_that_has_it(services):
    assert await movie_owner(services, 438631) is None
    services.radarr["vermithor"].movie_list = [dune()]
    owner = await movie_owner(services, 438631)
    assert owner.host == "vermithor" and owner.item.id == 8


async def test_two_owners_are_refused_not_guessed(services):
    services.radarr["meleys"].movie_list = [dune()]
    services.radarr["vermithor"].movie_list = [dune()]
    with pytest.raises(AmbiguousOwner, match="radarr on meleys and vermithor"):
        await movie_owner(services, 438631)


async def test_an_unreachable_instance_fails_the_lookup(services):
    class Down:
        async def movie_by_tmdb(self, tmdb_id):
            raise ConnectionError("meleys is down")

    services.radarr["meleys"] = Down()
    services.radarr["vermithor"].movie_list = [dune()]
    with pytest.raises(ConnectionError):
        await movie_owner(services, 438631)
