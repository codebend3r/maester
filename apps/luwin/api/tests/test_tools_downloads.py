from dataclasses import replace

from luwin.agent.tools import Result, Tier, registry
from luwin.clients.arr import HistoryEvent, QueueItem
from luwin.clients.radarr import Movie
from luwin.clients.sabnzbd import Download
from luwin.clients.seerr import MediaDetails, MediaStatus
from luwin.tools.downloads import download_history
from tests.factories import seerr_server

DUNE = MediaDetails(438631, "movie", "Dune", 2021, "", MediaStatus.PROCESSING, MediaStatus.UNKNOWN)


def dune_on_meleys(ctx):
    ctx.services.seerr.details[("movie", 438631)] = DUNE
    radarr = ctx.services.radarr["meleys"]
    radarr.movie_list = [Movie(8, "Dune", 438631, 2021, "/Movies/Dune (2021)", True, False, None)]
    radarr.events[8] = [
        HistoryEvent(1002, "downloadFailed", "Dune.2021.1080p.BluRay.x264-GROUP",
                     "2026-09-20T19:12:44Z", "SABnzbd_nzo_dune",
                     "Unpacking failed, write error or disk is full?"),
        HistoryEvent(1001, "grabbed", "Dune.2021.1080p.BluRay.x264-GROUP", "2026-09-20T18:00:00Z",
                     "SABnzbd_nzo_dune", "", indexer="NZBgeek", release_group="GROUP"),
    ]  # fmt: skip
    ctx.services.sabnzbd["meleys"].history_items = [
        Download("SABnzbd_nzo_dune", "Dune.2021.1080p.BluRay.x264-GROUP", "Failed", 0, 12000,
                 None, "Unpacking failed, write error or disk is full?",
                 ("Unpack: [Dune] Unpacking failed, write error or disk is full?",), 1790000000),
        Download("SABnzbd_nzo_else", "Something.Else", "Completed", 100, 1, None),
    ]  # fmt: skip
    return replace(ctx, tier=Tier.ADMIN)


async def test_the_owning_hosts_history_and_sabnzbds_record_of_it(ctx):
    admin = dune_on_meleys(ctx)
    out = await download_history(admin, 438631, "movie")
    assert (out["host"], out["arr"], out["queue"]) == ("meleys", "Radarr on meleys", [])
    failed, grabbed = out["history"]
    assert failed == {
        "when": "2026-09-20T19:12:44Z",
        "event": "download failed",
        "release": "Dune.2021.1080p.BluRay.x264-GROUP",
        "why": "Unpacking failed, write error or disk is full?",
    }
    assert grabbed["indexer"] == "NZBgeek" and grabbed["release_group"] == "GROUP"
    (sab,) = out["sabnzbd"]
    assert sab["status"] == "Failed" and sab["steps"] == [
        "Unpack: [Dune] Unpacking failed, write error or disk is full?"
    ]
    assert sab["finished"].startswith("2026-09-21")


async def test_a_stuck_download_shows_its_queue_entry(ctx):
    admin = dune_on_meleys(ctx)
    ctx.services.radarr["meleys"].queue_items = [
        QueueItem(402, "Dune.2021.1080p.WEB", "warning", 100, 40, None,
                  ("The download is stalled with no connections",), "SABnzbd_nzo_new", 8,
                  "warning"),
    ]  # fmt: skip
    ctx.services.sabnzbd["meleys"].queue_items = [
        Download("SABnzbd_nzo_new", "Dune.2021.1080p.WEB", "Downloading", 60.0, 100, "0:10:00")
    ]
    out = await download_history(admin, 438631, "movie", host="Meleys")
    (queued,) = out["queue"]
    assert queued["messages"] == ["The download is stalled with no connections"]
    assert out["sabnzbd"][0] == {
        "name": "Dune.2021.1080p.WEB",
        "status": "Downloading",
        "time_left": "0:10:00",
    }


async def test_a_host_that_doesnt_hold_it_is_refused_and_a_silent_sabnzbd_is_named(ctx):
    admin = dune_on_meleys(ctx)
    out = await download_history(admin, 438631, "movie", host="vermithor")
    assert out == Result.refusal("Dune (2021) is on the Radarr on meleys, not vermithor.")
    ctx.services.sabnzbd["meleys"].down = True

    async def down(limit=50):
        ctx.services.sabnzbd["meleys"].refuse_if_down("/api?mode=history")

    ctx.services.sabnzbd["meleys"].history = down
    out = await download_history(admin, 438631, "movie")
    assert "SABnzbd on meleys didn't answer" in out["sabnzbd_note"] and out["history"]


async def test_download_history_is_the_admins_alone(ctx):
    spec = registry.get("download_history")
    assert spec.tier == Tier.ADMIN and spec.host_param == "host" and not spec.destructive
    assert "download_history" not in {s.name for s in registry.for_tier(Tier.TRUSTED)}
    ctx.services.seerr.arr_servers["radarr"] = [seerr_server(1, "movie", "vermithor", is_4k=True)]
    admin = dune_on_meleys(ctx)
    out = await download_history(admin, 438631, "movie", version="4K")
    assert out.is_error and "4K copy" in out.content
