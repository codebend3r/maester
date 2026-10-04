from datetime import date, timedelta

from luwin.clients.arr import DiskSpace, RootFolder
from luwin.clients.base import ClientError
from luwin.config import Settings
from luwin.jobs.space import sample_space
from luwin.storage import (
    Space,
    Volume,
    forecasts,
    merged,
    read_space,
    sample_of,
    volumes_of,
)
from luwin.store import SpaceSample

TB = 1_000_000_000_000


def test_a_root_folder_is_the_disk_it_sits_on_or_else_itself():
    disks = [
        DiskSpace("/", 50 * 10**9, 100 * 10**9),
        DiskSpace("/Vermithor", 4 * TB, 40 * TB),
        DiskSpace("/Vermithor/Scratch", 1 * TB, 2 * TB),
    ]
    roots = [
        RootFolder("/Vermithor/Movies"),
        RootFolder("/Syrax/Movies", 2 * TB, 10 * TB),  # a share this arr lists no disk for
        RootFolder("/Caraxes/Movies"),  # nothing known about it
    ]
    found = volumes_of("vermithor", roots, disks)
    assert [(v.path, v.free_bytes, v.total_bytes) for v in found] == [
        ("/Vermithor", 4 * TB, 40 * TB),
        ("/", 50 * 10**9, 100 * 10**9),  # "/Syrax" isn't mounted here: its folder is on "/"
        ("/", 50 * 10**9, 100 * 10**9),
    ]
    assert volumes_of("h", [RootFolder("/Syrax/Movies", 2 * TB, 10 * TB)], [])[0].path == (
        "/Syrax/Movies"
    )
    assert volumes_of("h", [RootFolder("/Caraxes/Movies")], []) == []


def test_one_share_seen_by_two_arrs_on_two_hosts_is_one_volume():
    GB = 10**9
    a = Volume("/Syrax", 2 * TB + 3 * GB, 10 * TB, ("meleys",), ("/Syrax/TV",))
    b = Volume("/Syrax/", 2 * TB, 10 * TB, ("vermithor",), ("/Syrax/Movies",))
    # Same path and size, but free space that far apart is another disk.
    twin = Volume("/Syrax", 6 * TB, 10 * TB, ("vhagar",), ("/Syrax/Anime",))
    shared, other = merged([a, b, twin])
    assert shared.free_bytes == 2 * TB and shared.hosts == ("meleys", "vermithor")
    assert shared.roots == ("/Syrax/Movies", "/Syrax/TV") and other.hosts == ("vhagar",)
    assert shared.used_percent == 80.0
    assert shared.describe() == "/Syrax (meleys, vermithor): 2.0 TB free of 10.0 TB, 80% used"


def test_the_volume_holding_a_root_is_the_deepest_mount_on_that_host():
    space = Space(
        (
            Volume("/", 1, 10, ("vermithor",), ("/Movies",)),
            Volume("/Vermithor", 4 * TB, 40 * TB, ("vermithor",), ("/Vermithor/Movies",)),
        ),
        {},
    )
    assert space.holding("vermithor", "/Vermithor/Movies").path == "/Vermithor"
    assert space.holding("vermithor", "/Vermithor/4K").path == "/Vermithor"
    assert space.holding("meleys", "/Vermithor/Movies") is None


async def test_every_hosts_arrs_are_read_and_one_that_cant_answer_is_named(services):
    services.radarr["meleys"].disks = [DiskSpace("/Movies", 1 * TB, 16 * TB)]
    services.sonarr["vermithor"].down = True
    space = await read_space(services)
    assert set(space.unreachable) == {"Sonarr on vermithor"}
    assert "connection refused" in space.unreachable["Sonarr on vermithor"]
    labels = {v.label: v.free_bytes for v in space.volumes}
    # meleys' Radarr lists the disk; the fakes' other root folders report their own space.
    assert labels["/Movies (meleys)"] == 1 * TB and labels["/Movies (vermithor)"] == 8 * TB
    assert labels["/TV (meleys)"] == 8 * TB


async def test_a_bug_reading_space_is_raised_not_hidden(services):
    async def broken():
        raise KeyError("freeSpace")

    services.radarr["meleys"].root_folders = broken
    try:
        await read_space(services)
    except KeyError:
        pass
    else:
        raise AssertionError("a bug must raise")
    assert ClientError  # the only failure that's named instead


def samples(volume, start, frees, *, total=40 * TB, label="/Vermithor (vermithor)"):
    return [
        SpaceSample(volume, start + timedelta(days=n), label, int(free), total)
        for n, free in enumerate(frees)
    ]


def test_a_forecast_fits_a_line_through_the_samples_and_says_when_it_fills():
    start = date(2026, 9, 1)
    # 4 TB free, losing 100 GB a day: 30 days of samples end at 1.1 TB.
    filling = samples("v|40", start, [4 * TB - n * 100 * 10**9 for n in range(30)])
    steady = samples("s|10", start, [6 * TB] * 10, total=10 * TB, label="/Syrax (meleys)")
    young = samples("y|5", start + timedelta(days=27), [TB] * 3, total=5 * TB, label="/New (x)")
    first, second, third = forecasts(young + steady + filling)
    assert round(first.used_per_day) == 100 * 10**9 and round(first.days_left) == 11
    assert first.describe() == (
        "/Vermithor (vermithor): 1.1 TB free, filling about 100.0 GB a day: full in about 11 "
        "days (around Oct 11)."
    )
    assert second.days_left is None and second.describe().endswith(
        "not filling over the last 10 days."
    )
    assert third.describe() == (
        "/New (x): 1.0 TB free; 3 days of samples so far, a forecast needs 7."
    )


def test_a_samples_key_is_its_path_size_and_hosts():
    volume = Volume("/Syrax", 2 * TB, 10 * TB, ("meleys", "vermithor"), ("/Syrax/TV",))
    sample = sample_of(volume, date(2026, 9, 27))
    assert (sample.volume, sample.label) == (
        f"/Syrax|{10 * TB}|meleys,vermithor",
        "/Syrax (meleys, vermithor)",
    )


async def test_the_daily_sample_keeps_one_per_volume_per_day(services, store):
    services.radarr["meleys"].disks = [DiskSpace("/Movies", 1 * TB, 16 * TB)]
    await sample_space(services, store, Settings())
    services.radarr["meleys"].disks = [DiskSpace("/Movies", TB // 2, 16 * TB)]
    await sample_space(services, store, Settings())
    kept = store.space_since(date(2000, 1, 1))
    movies = [s for s in kept if s.label == "/Movies (meleys)"]
    assert [s.free_bytes for s in movies] == [TB // 2]


async def test_a_day_an_arr_cant_answer_is_skipped_whole(services, store):
    services.sonarr["vermithor"].down = True
    await sample_space(services, store, Settings())
    assert store.space_since(date(2000, 1, 1)) == []
