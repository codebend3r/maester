"""Each arr's library client through respx, its fake, and the admin's arr tools."""

import pytest
import respx

from sparrow.agent.tools import Failed, Ok, Refused, Tier, ToolContext
from sparrow.clients.arr import RootFolder
from sparrow.clients.arr_library import ArrLibraryClient, CustomFilter, FakeArrLibrary, HistoryRow
from sparrow.config import Settings
from sparrow.memo import Memo
from sparrow.tools.arrs import (
    Pick,
    UnreadableRule,
    arr_history,
    arr_move,
    arr_overview,
    arr_titles,
    holds,
    letter_folder,
)

BASE = "http://radarr.test"
REQUESTED = CustomFilter(
    "Movies (Requested)",
    "movieIndex",
    ({"key": "path", "value": ["/Meleys/Movies/Requests/"], "type": "contains"},),
)
MISSING = CustomFilter(
    "Movies (Missing)",
    "movieIndex",
    (
        {"key": "path", "value": ["/Meleys/Movies/"], "type": "contains"},
        {"key": "sizeOnDisk", "value": [0], "type": "equal"},
    ),
)


def movie(n, title, folder, size=0, **extra):
    return {
        "id": n,
        "title": title,
        "year": 2026,
        "path": folder,
        "monitored": size == 0,
        "status": "released",
        "hasFile": size > 0,
        "sizeOnDisk": size,
        **extra,
    }


def radarr(**kwargs):
    return FakeArrLibrary(
        service="radarr",
        host="vermithor",
        records=[
            movie(1, "Love Liza", "/Meleys/Movies/Requests/Love Liza (2002)", 1_500_000_000),
            movie(2, "25th Hour", "/Meleys/Movies/Requests/25th Hour (2002)", 36_000_000_000),
            movie(3, "Digger", "/Meleys/Movies/Requests/Digger (2026)"),
            movie(4, "Dune", "/Meleys/Movies/D/Dune (2021)", 20_000_000_000),
        ],
        filters=[REQUESTED, MISSING],
        roots=[RootFolder(f"/Meleys/Movies/{p}") for p in ("#", "D", "L", "Requests")],
        **kwargs,
    )


def admin_with(services, *libraries):
    services.arr_libraries = {}
    for lib in libraries:
        services.arr_libraries.setdefault(lib.service, {})[lib.host] = lib
    return ToolContext("d1", Tier.ADMIN, services, None, Settings(), Memo())


def test_a_rule_reads_the_record_the_way_the_arrs_list_does():
    record = {
        "path": "/Meleys/Movies/A/Up",
        "tags": [1, 3],
        "monitored": True,
        "statistics": {"sizeOnDisk": 5},
    }
    assert holds({"key": "path", "value": ["/meleys/movies/"], "type": "contains"}, record)
    assert holds({"key": "path", "value": ["/Syrax/"], "type": "notContains"}, record)
    assert holds({"key": "tags", "value": [3], "type": "equal"}, record)
    assert holds({"key": "monitored", "value": [True], "type": "equal"}, record)
    assert holds({"key": "sizeOnDisk", "value": [0], "type": "greaterThan"}, record)
    with pytest.raises(UnreadableRule, match="added"):
        holds({"key": "added", "value": [7], "type": "inLast"}, record)
    with pytest.raises(UnreadableRule, match="inLast"):
        holds({"key": "path", "value": [7], "type": "inLast"}, record)


def test_a_title_files_under_its_first_letter_or_the_hash():
    assert [letter_folder(f) for f in ("Late Quartet, A (2012)", "25th Hour (2002)", "élan")] == [
        "L",
        "#",
        "É",
    ]


async def test_arr_titles_picks_by_a_saved_filter_and_sorts(services):
    ctx = admin_with(services, radarr())
    reply = await arr_titles(ctx, "radarr", custom_filter="movies (requested)", sort="size")
    assert isinstance(reply, Ok)
    assert reply.content["matched"] == 3 and reply.content["hosts"] == ["vermithor"]
    assert [t["title"] for t in reply.content["titles"]] == ["25th Hour", "Love Liza", "Digger"]
    assert reply.content["titles"][2] == {
        "title": "Digger",
        "year": 2026,
        "path": "/Meleys/Movies/Requests/Digger (2026)",
        "downloaded": False,
        "monitored": True,
        "status": "released",
    }
    missing = await arr_titles(ctx, "radarr", custom_filter="Movies (Missing)")
    assert [t["title"] for t in missing.content["titles"]] == ["Digger"]
    on_disk = await arr_titles(ctx, "radarr", path="/Requests/", on_disk="complete", limit=1)
    assert on_disk.content["matched"] == 2 and "1 more left out" in on_disk.content["note"]


async def test_arr_titles_refuses_what_it_cannot_answer(services):
    ctx = admin_with(services, radarr())
    unknown = await arr_titles(ctx, "radarr", custom_filter="Nope")
    assert (
        isinstance(unknown, Refused) and "Movies (Requested), Movies (Missing)" in unknown.content
    )
    elsewhere = await arr_titles(ctx, "radarr", host="meleys")
    assert isinstance(elsewhere, Refused) and "runs on vermithor" in elsewhere.content
    absent = await arr_titles(ctx, "lidarr")
    assert isinstance(absent, Refused) and "LIDARR_<HOST>_URL" in absent.content
    down = radarr()
    down.down = True
    failed = await arr_titles(admin_with(services, down), "radarr")
    assert isinstance(failed, Failed) and failed.retryable


async def test_every_host_answers_and_names_its_own(services):
    other = FakeArrLibrary(
        service="radarr", host="meleys", records=[movie(9, "Arrival", "/Movies/A/Arrival", 1)]
    )
    reply = await arr_titles(admin_with(services, radarr(), other), "radarr", title="arr")
    assert reply.content["titles"] == [
        {**reply.content["titles"][0], "title": "Arrival", "host": "meleys"}
    ]


async def test_arr_overview_counts_each_root_folder_and_shows_the_filters(services):
    ctx = admin_with(services, radarr(health=["error: root folder missing"], queued=2))
    reply = await arr_overview(ctx, "radarr", host="vermithor")
    host = reply.content["hosts"]["vermithor"]
    assert host["titles"]["total"] == 4 and host["titles"]["missing"] == 1
    assert {r["path"]: r["titles"] for r in host["root_folders"]} == {
        "/Meleys/Movies/#": 0,
        "/Meleys/Movies/D": 1,
        "/Meleys/Movies/L": 0,
        "/Meleys/Movies/Requests": 3,
    }
    assert host["custom_filters"][0] == {
        "label": "Movies (Requested)",
        "list": "movieIndex",
        "rules": ["path contains /Meleys/Movies/Requests/"],
    }
    assert host["health"] == ["error: root folder missing"] and host["queued"] == 2


async def test_arr_history_narrows_to_one_kind_of_event(services):
    events = [
        HistoryRow(
            "2026-10-29T04:08:53Z", "downloadFailed", "Chicago P.D. S14E04", "x", None, "Aborted"
        ),
        HistoryRow(
            "2026-10-28T20:22:32Z",
            "downloadFolderImported",
            "Dune (2021)",
            "y",
            "WEBDL-1080p",
            None,
        ),
    ]
    ctx = admin_with(services, radarr(events=events))
    failed = await arr_history(ctx, "radarr", event="failed")
    assert failed.content["events"] == [
        {
            "when": "2026-10-29T04:08:53Z",
            "event": "download failed",
            "title": "Chicago P.D. S14E04",
            "release": "x",
            "why": "Aborted",
        }
    ]
    every = await arr_history(ctx, "radarr", count=1)
    assert [e["title"] for e in every.content["events"]] == ["Chicago P.D. S14E04"]


async def test_arr_move_sends_each_title_to_its_letter_folder(services):
    lib = radarr()
    lib.roots = [r for r in lib.roots if r.path != "/Meleys/Movies/D"]
    ctx = admin_with(services, lib)
    reply = await arr_move(
        ctx,
        "radarr",
        "vermithor",
        custom_filter="Movies (Requested)",
        to_letter_buckets_under="/Meleys/Movies/",
    )
    assert isinstance(reply, Ok)
    assert lib.moved == [
        (1, "/Meleys/Movies/L/Love Liza (2002)"),
        (2, "/Meleys/Movies/#/25th Hour (2002)"),
    ]
    assert reply.content["skipped"] == [
        {"title": "Digger", "why": "/Meleys/Movies/D isn't one of its root folders"}
    ]
    again = await arr_move(
        ctx, "radarr", "vermithor", title="Love Liza", to_root_folder="/Meleys/Movies/L"
    )
    assert again.content["moved"] == [] and again.content["skipped"][0]["why"] == "already there"


async def test_arr_move_needs_titles_and_one_destination(services):
    ctx = admin_with(services, radarr())
    none = await arr_move(ctx, "radarr", "vermithor", to_root_folder="/Meleys/Movies/L")
    assert isinstance(none, Refused) and "which titles" in none.content
    both = await arr_move(
        ctx, "radarr", "vermithor", title="Liza", to_root_folder="/a", to_letter_buckets_under="/b"
    )
    assert isinstance(both, Refused) and "not both" in both.content
    nothing = await arr_move(
        ctx, "radarr", "vermithor", title="Heat", to_root_folder="/Meleys/Movies/L"
    )
    assert isinstance(nothing, Refused) and "Nothing matches" in nothing.content


def test_pick_needs_every_part_to_hold():
    lib = radarr()
    titles = [t for t in __import__("asyncio").run(lib.titles())]
    picked = Pick(custom_filter="Movies (Requested)", title="hour").chosen(titles, (REQUESTED,))
    assert [t.title for t in picked] == ["25th Hour"]


@respx.mock
async def test_the_client_reads_radarr_and_moves_through_its_editor():
    respx.get(f"{BASE}/api/v3/movie").respond(
        json=[
            movie(
                7,
                "Love Liza",
                "/Meleys/Movies/Requests/Love Liza (2002)",
                1,
                qualityProfileId=4,
                tags=[1],
                movieFile={"quality": {"quality": {"name": "WEBRip-1080p"}}},
                digitalRelease="2003-05-27T00:00:00Z",
            )
        ]
    )
    respx.get(f"{BASE}/api/v3/qualityprofile").respond(json=[{"id": 4, "name": "HD-1080p"}])
    respx.get(f"{BASE}/api/v3/tag").respond(json=[{"id": 1, "label": "1-cjrivas"}])
    client = ArrLibraryClient("radarr", "vermithor", BASE, "key")
    (liza,) = await client.titles()
    assert (liza.profile, liza.tags, liza.quality, liza.release) == (
        "HD-1080p",
        ("1-cjrivas",),
        "WEBRip-1080p",
        "2003-05-27",
    )
    assert liza.folder == "Love Liza (2002)" and (liza.have, liza.want) == (1, 1)
    respx.get(f"{BASE}/api/v3/movie/7").respond(
        json={"id": 7, "path": liza.path, "title": "Love Liza"}
    )
    put = respx.put(f"{BASE}/api/v3/movie/7", params={"moveFiles": "true"}).respond(202, json={})
    await client.move(7, "/Meleys/Movies/L/Love Liza (2002)")
    sent = __import__("json").loads(put.calls.last.request.content)
    assert sent["path"] == "/Meleys/Movies/L/Love Liza (2002)"
    assert sent["rootFolderPath"] == "/Meleys/Movies/L"


@respx.mock
async def test_lidarr_lists_artists_on_v1_with_their_tracks():
    base = "http://lidarr.test"
    artist = {
        "id": 1,
        "artistName": "2 Chainz",
        "path": "/Caraxes/Music Lossless/2 Chainz",
        "monitored": True,
        "status": "continuing",
        "statistics": {"trackFileCount": 93, "trackCount": 139, "sizeOnDisk": 3_892_033_756},
    }
    respx.get(f"{base}/api/v1/artist").respond(json=[artist])
    respx.get(f"{base}/api/v1/qualityprofile").respond(json=[])
    respx.get(f"{base}/api/v1/tag").respond(json=[])
    history = respx.get(
        f"{base}/api/v1/history", params={"includeArtist": "true", "includeAlbum": "true"}
    ).respond(
        json={
            "records": [
                {
                    "date": "2026-10-01T00:00:00Z",
                    "eventType": "trackFileImported",
                    "sourceTitle": "2 Chainz - Rap or Go to the League",
                    "artist": {"artistName": "2 Chainz"},
                    "album": {"title": "Rap or Go to the League"},
                }
            ]
        }
    )
    client = ArrLibraryClient("lidarr", "vermithor", base, "key")
    (chainz,) = await client.titles()
    assert (chainz.title, chainz.have, chainz.want, chainz.size_bytes) == (
        "2 Chainz",
        93,
        139,
        3_892_033_756,
    )
    (event,) = await client.history(5)
    assert event.title == "2 Chainz: Rap or Go to the League"
    assert history.calls.last.request.url.params["pageSize"] == "5"
