from dataclasses import replace

from luwin.agent.limits import KillSwitch
from luwin.clients.arr import DiskSpace
from luwin.clients.fleet import HostHealth
from luwin.config import Settings
from luwin.jobs import scheduled
from luwin.jobs.nas import nas_report

TB = 10**12
HEALTHY = HostHealth(
    "meleys", True, "ok", disk_percent=62, disk_free_bytes=31 * TB, memory_percent=48,
    load_per_core=0.3, uptime_percent_24h=100, temperatures={"coretemp.temp1": 54.0},
)  # fmt: skip


def blocks(text: str) -> dict[str, list[str]]:
    found = {}
    for block in text.split("\n\n")[1:]:
        head, *lines = block.splitlines()
        found[head.strip("*")] = [line.removeprefix("- ") for line in lines]
    return found


async def test_anything_degraded_comes_first_and_the_rest_is_fine(services):
    services.fleet.health = [
        HEALTHY,
        replace(HEALTHY, name="vermithor", disk_percent=93.5, temperatures={"coretemp.temp1": 84.0},
                containers_down=("tautulli",), uptime_percent_24h=97.5),
        HostHealth("caraxes", False, "unknown"),
    ]  # fmt: skip
    services.radarr["meleys"].disks = [DiskSpace("/Movies", int(0.5 * TB), 16 * TB)]
    (post,) = await nas_report(services, Settings())
    assert post.text.startswith("**Weekly NAS health, ")
    found = blocks(post.text)
    assert found["Needs a look"][:2] == [
        "caraxes: the fleet monitor hasn't heard from it in a day. (no readings)",
        "vermithor: /volume1 is 93.5% used; coretemp.temp1 is at 84°C; up only 97.5% of the last "
        "day; container tautulli is down. (/volume1 93.5% used (31.0 TB free), memory 48%, load "
        "0.3 per core, hottest 84°C, up 97.5% of the last day)",
    ]
    assert found["Needs a look"][2].startswith("/Movies (meleys): 500.0 GB free")
    assert found["Fine"][0] == (
        "meleys: /volume1 62% used (31.0 TB free), memory 48%, load 0.3 per core, hottest 54°C, "
        "up 100% of the last day"
    )
    assert found["Not checked"] == [
        "Drive SMART health isn't read: the fleet monitor has no SMART probe yet, and luwin "
        "runs no SSH."
    ]


async def test_without_the_fleet_monitor_the_volumes_are_still_reported(services):
    services.fleet = None
    services.sonarr["meleys"].down = True
    found = blocks((await nas_report(services, Settings()))[0].text)
    assert "Needs a look" not in found and found["Fine"]
    assert found["Not checked"][0].startswith("The fleet monitor isn't set up")
    assert found["Not checked"][1].startswith("Sonarr on meleys:")


def test_every_job_is_scheduled_from_the_settings(services, store):
    jobs = {j.name: j.when for j in scheduled(services, store, Settings(), KillSwitch(store))}
    assert set(jobs) == {
        "sweep",
        "space_sample",
        "digest",
        "landed",
        "expiry_reminders",
        "nas_report",
    }
    assert jobs["nas_report"].weekday == 0 and jobs["digest"].weekday is None
