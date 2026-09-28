import pytest

from maester.agent.tools import Choices, Result
from maester.clients.seerr import (
    Collection,
    MediaDetails,
    MediaStatus,
    Quota,
    Quotas,
    Refusal,
    RequestRefused,
    SearchResult,
)
from maester.tools.collections import find_collection, request_collection

S = MediaStatus
UNLIMITED_TV = Quota(None, None, 0, None, False)


def part(tmdb_id, title, year, status=S.UNKNOWN):
    return SearchResult(tmdb_id, "movie", title, year, "", None, status, S.UNKNOWN)


MI = Collection(
    87359,
    "Mission: Impossible Collection",
    (
        part(954, "Mission: Impossible", 1996, S.AVAILABLE),
        part(955, "Mission: Impossible II", 2000),
        part(956, "Mission: Impossible III", 2006, S.PENDING),
        part(56292, "Ghost Protocol", 2011),
        part(177677, "Rogue Nation", 2015),
    ),
)


@pytest.fixture
def seerr(ctx):
    seerr = ctx.services.seerr
    seerr.details[("movie", 954)] = MediaDetails(
        954, "movie", "Mission: Impossible", 1996, "", S.AVAILABLE, S.UNKNOWN, collection_id=87359
    )
    seerr.collections[87359] = MI
    return seerr


async def test_the_picker_shows_every_entry_led_by_all_missing(ctx, seerr):
    out = await find_collection(ctx, 954)
    assert isinstance(out, Choices)
    everything, *entries = out.items
    assert everything.label == "All 3 missing from Mission: Impossible Collection"
    assert everything.value == "collection:87359"
    assert [e.value for e in entries] == [f"movie:{p.tmdb_id}" for p in MI.parts]
    assert entries[0].detail.startswith("Movie · on the server")
    assert entries[2].detail.startswith("Movie · requested")


async def test_no_collection_or_nothing_missing(ctx, seerr):
    seerr.details[("movie", 1)] = MediaDetails(1, "movie", "Solo", 2020, "", S.UNKNOWN, S.UNKNOWN)
    assert (await find_collection(ctx, 1))["collection"] is None
    seerr.collections[87359] = Collection(87359, "MI", MI.parts[:1])
    out = await find_collection(ctx, 954)
    assert out["entries"] == [
        {"title": "Mission: Impossible", "year": 1996, "availability": "on the server"}
    ]


async def test_one_request_per_missing_entry_summed_up(ctx, seerr):
    seerr.refusals[177677] = RequestRefused(Refusal.BLOCKLISTED, "This media is blocklisted.")
    out = await request_collection(ctx, 87359)
    assert out["requested"] == [
        {"title": "Mission: Impossible II", "request_id": 1, "auto_approved": False},
        {"title": "Ghost Protocol", "request_id": 2, "auto_approved": False},
    ]
    assert out["refused"] == [
        {"title": "Rogue Nation", "reason": "That title is blocklisted on this server."}
    ]
    assert out["already_there"] == [
        {"title": "Mission: Impossible", "status": "on the server"},
        {"title": "Mission: Impossible III", "status": "requested, waiting for approval"},
    ]
    assert {r.requested_by_id for r in seerr.requests} == {4}


async def test_a_collection_over_the_quota_is_explained_not_half_requested(ctx, seerr):
    seerr.quotas[4] = Quotas(Quota(5, 7, 3, 2, False), UNLIMITED_TV)
    out = await request_collection(ctx, 87359)
    assert out.is_error and seerr.requests == []
    assert out.content == (
        "Nothing was requested: Mission: Impossible Collection needs 3 movie requests "
        "(Mission: Impossible II, Ghost Protocol, Rogue Nation), but this account has 2 of 5 "
        "left for the next 7 days. Ask which ones they want most."
    )

    seerr.quotas[4] = Quotas(Quota(5, 7, 2, 3, False), UNLIMITED_TV)
    assert len((await request_collection(ctx, 87359))["requested"]) == 3


async def test_nothing_requested_is_a_refusal(ctx, seerr):
    seerr.collections[87359] = Collection(87359, "MI", MI.parts[:1])  # nothing missing
    assert (await request_collection(ctx, 87359)) == Result.refusal(
        "Nothing was requested: every entry of MI is already on the server or requested."
    )
    seerr.collections[87359] = MI
    for tmdb_id in (955, 56292, 177677):
        seerr.refusals[tmdb_id] = RequestRefused(Refusal.BLOCKLISTED, "blocklisted")
    out = await request_collection(ctx, 87359)
    assert out.is_error and out.content.startswith(
        "Seerr took none of Mission: Impossible Collection's requests. Mission: Impossible II: "
        "That title is blocklisted on this server."
    )
