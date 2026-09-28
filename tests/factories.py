"""Small builders for records tests need often, with defaults worth overriding."""

from maester.clients.seerr import ArrServer

HOSTS = ("meleys", "vermithor")
# Where each fake arr says it lives, so Seerr's servers can be matched to a host.
RADARR_URL, SONARR_URL = "http://{host}.lan:7878", "http://{host}.lan:8989"


def seerr_server(server_id: int, kind: str, host: str, *, is_4k: bool = False) -> ArrServer:
    """Seerr's record of a Radarr ("movie") or Sonarr ("tv") pointing at a fake's host."""
    url = (RADARR_URL if kind == "movie" else SONARR_URL).format(host=host)
    return ArrServer(server_id, f"{host} {'4K' if is_4k else 'HD'}", is_4k, True, url)
