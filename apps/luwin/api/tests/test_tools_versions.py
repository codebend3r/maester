import time
from datetime import timedelta

from maester.agent.tools import Tier, registry
from maester.clients.plex import PlexItem, Version
from maester.tools.versions import GUESSED, pick_version
from tests.factories import history_row, session
from tests.playback_world import DUNE

REMUX = Version("4k", "hevc", 62103, 72_600_000_000, "/Vermithor/Movies/Dune (2021)/Dune (2021) Bluray-2160p.mkv")  # fmt: skip
REENCODE = Version("4k", "hevc", 18412, 21_500_000_000, "/Vermithor/Movies/Dune (2021)/Dune (2021) 2160p HEVC.mkv")  # fmt: skip
WEBDL = Version("1080", "h264", 10240, 12_000_000_000, "/Meleys/Movies/Dune (2021)/Dune (2021) WEBDL-1080p.mkv")  # fmt: skip


def dune(ctx, *uhd: Version):
    ctx.services.seerr.details[("movie", 438631)] = DUNE
    ctx.services.plex.items = {
        "4348": PlexItem("4348", "Dune", "movie", 2021, (), (WEBDL,)),
        "9001": PlexItem("9001", "Dune", "movie", 2021, (), uhd or (REMUX, REENCODE)),
    }


async def test_versions_are_listed_and_one_recommended_for_the_speed_given(ctx):
    dune(ctx)
    out = await pick_version(ctx, 438631, connection_mbps=20)
    assert [(v["version"], v["bitrate_mbps"]) for v in out["versions"]] == [
        ("1080p", 10.2), ("4K", 62.1), ("4K HEVC re-encode", 18.4),
    ]  # fmt: skip
    assert out["recommended"] == {
        "version": "1080p",
        "fits": True,
        "remote_quality": "Original",
        "connection": "about 20 Mbps: you said about 20 Mbps",
    }
    assert (await pick_version(ctx, 438631, connection_mbps=30))["recommended"]["version"] == (
        "4K HEVC re-encode"
    )
    assert (await pick_version(ctx, 438631, connection_mbps=500))["recommended"]["version"] == "4K"
    assert "note" not in out


async def test_with_nothing_known_a_typical_remote_connection_is_assumed(ctx):
    dune(ctx)
    out = await pick_version(ctx, 438631)
    assert out["note"] == GUESSED and out["recommended"]["version"] == "1080p"
    assert "most connections away from home" in out["recommended"]["connection"]


async def test_their_last_play_away_from_home_limits_it(ctx):
    dune(ctx)
    ctx.store.upsert_user("d1", tautulli_user_id=7)
    ctx.services.tautulli["meleys"].sessions = [session(user_id=7, location="wan", relayed=True)]
    pick = (await pick_version(ctx, 438631, connection_mbps=50))["recommended"]
    assert (pick["version"], pick["fits"], pick["remote_quality"]) == (
        "1080p",
        False,
        "2 Mbps 720p",
    )
    assert pick["connection"] == "about 2 Mbps: Plex relays your stream, at most 2 Mbps"


async def test_nothing_on_plex_and_a_bad_speed(ctx):
    ctx.services.seerr.details[("movie", 438631)] = DUNE
    assert (await pick_version(ctx, 438631))["note"] == "No version of it is on Plex."
    refused = await pick_version(ctx, 438631, connection_mbps=0)
    assert refused.is_error and "above 0" in refused.content


async def test_asking_about_a_title_only_reads(ctx):
    """Flagging remuxes is the lag report's job; asking which version to play changes nothing."""
    dune(ctx, REMUX)
    now = int(time.time())
    ctx.services.tautulli["meleys"].history_rows = [
        history_row(rating_key="9001", location="wan", user_id=u, started=now - 60)
        for u in (1, 2, 3)
    ]
    assert isinstance(await pick_version(ctx, 438631), dict)
    assert ctx.store.claim("reencode", "9001", window=timedelta(days=30))  # nothing claimed it


def test_tool_is_registered_for_friends():
    assert "pick_version" in {s.name for s in registry.for_tier(Tier.FRIEND)}
