"""Small builders for records tests need often, with defaults worth overriding."""

from luwin.clients.seerr import ArrServer
from luwin.clients.tautulli import HistoryRow, Session

HOSTS = ("meleys", "vermithor")
# The Plex server luwin reads (`PLEX_URL`) is meleys' own, watched by meleys' Tautulli.
PLEX_ID = "fake-machine"
# Where each fake arr says it lives, so Seerr's servers can be matched to a host.
RADARR_URL, SONARR_URL = "http://{host}.lan:7878", "http://{host}.lan:8989"


def seerr_server(server_id: int, kind: str, host: str, *, is_4k: bool = False) -> ArrServer:
    """Seerr's record of a Radarr ("movie") or Sonarr ("tv") pointing at a fake's host."""
    url = (RADARR_URL if kind == "movie" else SONARR_URL).format(host=host)
    return ArrServer(server_id, f"{host} {'4K' if is_4k else 'HD'}", is_4k, True, url)


def session(**kw) -> Session:
    """A live Tautulli session: a direct-played 4K HEVC movie unless overridden."""
    base = dict(
        session_key="1", user_id=1, user="u", rating_key="1", full_title="Dune", media_type="movie",
        state="playing", progress_percent=10, platform="Roku", player="TV", product="Plex",
        location="wan", relayed=False, secure=True, bandwidth_kbps=8000, stream_bitrate_kbps=8000,
        transcode_decision="direct play", video_decision="", audio_decision="", subtitle_decision="",
        container="mkv", video_codec="hevc", video_resolution="4k",
        video_dynamic_range="SDR", audio_codec="eac3", audio_channels=6, subtitle_codec="",
        file="/x.mkv",
    )  # fmt: skip
    return Session(**{**base, **kw})


def history_row(**kw) -> HistoryRow:
    """A finished play in Tautulli's history."""
    base = dict(
        user_id=1, rating_key="1", full_title="Dune", media_type="movie", started=0, stopped=0,
        percent_complete=50, transcode_decision="direct play", platform="Roku", player="TV",
        location="lan", relayed=False, row_id=1, product="Plex for Roku",
    )  # fmt: skip
    return HistoryRow(**{**base, **kw})
