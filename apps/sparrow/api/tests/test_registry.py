from sparrow.registry import Instance, api_keys_needed, instances_from_env

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
    assert instances_from_env(ENV) == [
        Instance("radarr", "vermithor", "http://192.168.50.3:7878", ""),
        Instance("sonarr", "meleys", "http://192.168.50.2:27021", "m-son"),
        Instance("sonarr", "vermithor", "http://192.168.50.3:27021", "v-son"),
    ]


def test_every_instance_configured_with_a_url_needs_its_api_key():
    assert api_keys_needed(ENV) == [
        "RADARR_VERMITHOR_API_KEY",
        "SONARR_MELEYS_API_KEY",
        "SONARR_VERMITHOR_API_KEY",
    ]
