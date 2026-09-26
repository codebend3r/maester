import pytest

from maester.registry import Instance, NoOwningHost, Registry, UnknownInstance

ENV = {
    "SONARR_MELEYS_URL": "http://192.168.50.2:27021/",
    "SONARR_MELEYS_API_KEY": "m-son",
    "SONARR_VERMITHOR_URL": "http://192.168.50.3:27021",
    "SONARR_VERMITHOR_API_KEY": "v-son",
    "RADARR_VERMITHOR_URL": "http://192.168.50.3:7878",
    "SEERR_URL": "http://192.168.50.3:5055",
    "PLEX_MELEYS_URL": "ignored, not a per-host service",
    "TAUTULLI_MELEYS_URL": "",
}


def test_discovers_per_host_instances_from_env():
    reg = Registry.from_env(ENV)
    assert reg.hosts() == ["meleys", "vermithor"]
    assert reg.hosts("radarr") == ["vermithor"]
    assert reg.get("sonarr", "Meleys") == Instance(
        "sonarr", "meleys", "http://192.168.50.2:27021", "m-son"
    )


def test_unknown_host_names_the_known_ones():
    reg = Registry.from_env(ENV)
    with pytest.raises(UnknownInstance, match="known hosts: meleys, vermithor"):
        reg.get("sonarr", "syrax")
    with pytest.raises(UnknownInstance, match="known hosts: vermithor"):
        reg.get("radarr", "meleys")


def test_missing_keys_lists_instances_without_an_api_key():
    assert Registry.from_env(ENV).missing_keys() == ["RADARR_VERMITHOR_API_KEY"]


def test_host_for_path_uses_root_folders():
    reg = Registry.from_env(ENV)
    reg.update(reg.get("sonarr", "meleys").with_root_folders(["/Meleys/TV", "/Syrax/Anime"]))
    reg.update(reg.get("sonarr", "vermithor").with_root_folders(["/Vermithor/TV/"]))
    assert reg.host_for_path("sonarr", "/Syrax/Anime/Frieren/Season 01/ep.mkv").host == "meleys"
    assert reg.host_for_path("sonarr", "/Vermithor/TV/The Bear/S02E07.mkv").host == "vermithor"


def test_host_for_path_refuses_to_guess():
    reg = Registry.from_env(ENV)
    reg.update(reg.get("sonarr", "meleys").with_root_folders(["/Meleys/TV"]))
    with pytest.raises(NoOwningHost):
        reg.host_for_path("sonarr", "/Caraxes/TV/x.mkv")
    # A prefix that is not a whole folder name must not match either.
    with pytest.raises(NoOwningHost):
        reg.host_for_path("sonarr", "/Meleys/TVshows/x.mkv")


def test_host_for_path_refuses_when_two_instances_claim_it():
    reg = Registry.from_env(ENV)
    reg.update(reg.get("sonarr", "meleys").with_root_folders(["/Shared/TV"]))
    reg.update(reg.get("sonarr", "vermithor").with_root_folders(["/Shared/TV"]))
    with pytest.raises(NoOwningHost):
        reg.host_for_path("sonarr", "/Shared/TV/x.mkv")
