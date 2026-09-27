"""Small builders for records tests need often, with defaults worth overriding."""

from maester.clients.seerr import ArrServer
from maester.store import PendingAction

HOSTS = ("meleys", "vermithor")
# Where each fake arr says it lives, so Seerr's servers can be matched to a host.
RADARR_URL, SONARR_URL = "http://{host}.lan:7878", "http://{host}.lan:8989"


def pending_action(**overrides) -> PendingAction:
    fields = dict(
        id=1,
        kind="confirm",
        action="replace_media",
        requester="5",
        payload={},
        summary="replace it",
        decision=None,
        expires_at="2099-01-01T00:00:00.000Z",
        decided_by=None,
    )
    return PendingAction(**{**fields, **overrides})


def seerr_server(server_id: int, kind: str, host: str, *, is_4k: bool = False) -> ArrServer:
    """Seerr's record of a Radarr ("movie") or Sonarr ("tv") pointing at a fake's host."""
    url = (RADARR_URL if kind == "movie" else SONARR_URL).format(host=host)
    return ArrServer(server_id, f"{host} {'4K' if is_4k else 'HD'}", is_4k, True, url)
