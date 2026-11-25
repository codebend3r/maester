"""Small builders for records tests need often, with defaults worth overriding."""

from sparrow.clients.raven import LiveStream, PlaybackMode, RavenFile
from sparrow.clients.seerr import ArrServer

HOSTS = ("meleys", "vermithor")
# Where each fake arr says it lives, so Seerr's servers can be matched to a host.
RADARR_URL, SONARR_URL = "http://{host}.lan:7878", "http://{host}.lan:8989"


def seerr_server(server_id: int, kind: str, host: str, *, is_4k: bool = False) -> ArrServer:
    """Seerr's record of a Radarr ("movie") or Sonarr ("tv") pointing at a fake's host."""
    url = (RADARR_URL if kind == "movie" else SONARR_URL).format(host=host)
    return ArrServer(server_id, f"{host} {'4K' if is_4k else 'HD'}", is_4k, True, url)


def raven_file(**kw) -> RavenFile:
    """A file raven holds: a 4K HDR HEVC remux of Dune at 62 Mbps unless overridden."""
    base = dict(
        id=401, title="Dune", width=3840, video_codec="hevc", hdr=True, dolby_vision=None,
        bitrate_kbps=62_100, size_bytes=72_600_000_000,
    )  # fmt: skip
    return RavenFile(**{**base, **kw})


def live_stream(**kw) -> LiveStream:
    """A live stream in raven: `raven_file()` played as it is at home, in Chrome on a Mac."""
    base = dict(
        file=raven_file(), item_id=40, library="4K Movies", mode=PlaybackMode.DIRECT,
        device="Mac", browser="Chrome 141", address="192.168.50.20", send_kbps=None, quality=None,
    )  # fmt: skip
    return LiveStream(**{**base, **kw})
