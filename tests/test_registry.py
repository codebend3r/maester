import pytest

from maester.registry import Instance, Registry, UnknownInstance

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
