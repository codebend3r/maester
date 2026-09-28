from dataclasses import replace

import pytest

from maester.agent.tools import Result, Tier, registry
from maester.clients import ClientError
from maester.clients.arr import MediaFile
from maester.clients.radarr import Movie
from maester.clients.seerr import (
    ANIME_KEYWORD,
    MediaDetails,
    MediaStatus,
    Named,
    Quota,
    Quotas,
    Refusal,
    RequestRefused,
    RequestStatus,
    Season,
    ServerOptions,
)
from maester.clients.sonarr import Series
from maester.notify import DirectMessage
from maester.store import NotLinked
from maester.tools.requests import (
    decide_4k_request,
    follow_show,
    plan_seasons,
    request_media,
    request_media_4k,
)
from tests.factories import seerr_server

S = MediaStatus
DUNE = MediaDetails(438631, "movie", "Dune", 2021, "", S.UNKNOWN, S.UNKNOWN)
BEAR = MediaDetails(
    136315,
    "tv",
    "The Bear",
    2022,
    "",
    S.PARTIALLY_AVAILABLE,
    S.UNKNOWN,
    tvdb_id=403245,
    seasons=(
        Season(1, 8, S.AVAILABLE, S.UNKNOWN),
        Season(2, 10, S.PROCESSING, S.UNKNOWN),
        Season(3, 10, S.UNKNOWN, S.UNKNOWN),
    ),
)


def seed(ctx, *details):
    ctx.services.seerr.details.update({(d.media_type, d.tmdb_id): d for d in details})


def four_k_servers(ctx, kind="radarr"):
    """Seerr sends 4K to vermithor; nothing yet records a 1080p server."""
    media = "movie" if kind == "radarr" else "tv"
    ctx.services.seerr.arr_servers[kind] = [seerr_server(1, media, "vermithor", is_4k=True)]


async def test_movie_request_is_made_as_the_linked_friend(ctx):
    seed(ctx, DUNE)
    out = await request_media(ctx, 438631, "movie")
    assert out == {
        "title": "Dune (2021)",
        "version": "1080p",
        "requested": True,
        "request_id": 1,
        "auto_approved": False,
    }
    (req,) = ctx.services.seerr.requests
    assert req.requested_by_id == 4 and not req.is_4k


async def test_auto_approval_is_reported(ctx):
    seed(ctx, DUNE)
    ctx.services.seerr.auto_approve = True
    assert (await request_media(ctx, 438631, "movie"))["auto_approved"] is True


async def test_a_movie_already_there_is_not_requested_again(ctx):
    seed(ctx, replace(DUNE, status=S.AVAILABLE))
    out = await request_media(ctx, 438631, "movie")
    assert out["requested"] is False and out["status"] == "on the server"
    assert ctx.services.seerr.requests == []


async def test_refusals_are_explained_in_plain_words(ctx):
    seed(ctx, DUNE)
    seerr = ctx.services.seerr
    seerr.refusals[438631] = RequestRefused(Refusal.QUOTA, "Movie Quota exceeded.")
    seerr.quotas[4] = Quotas(Quota(10, 7, 10, 0, True), Quota(None, None, 0, None, False))
    out = await request_media(ctx, 438631, "movie")
    assert out["requested"] is False
    assert out["reason"].startswith("That's over this account's movie request quota: 10 of 10")
    seerr.refusals[438631] = RequestRefused(Refusal.DUPLICATE, "exists")
    assert (await request_media(ctx, 438631, "movie"))["reason"] == "It has already been requested."


async def test_an_unlinked_caller_is_refused(ctx):
    seed(ctx, DUNE)
    ctx.store.upsert_user("d1", status="revoked")
    with pytest.raises(NotLinked):
        await request_media(ctx, 438631, "movie")


async def test_tv_requests_leave_out_seasons_already_there(ctx):
    seed(ctx, BEAR)
    out = await request_media(ctx, 136315, "tv")
    assert out["requested"] is True and out["seasons"] == [3]
    assert out["left_out"] == [
        {"season": 1, "status": "on the server"},
        {"season": 2, "status": "requested, downloading"},
    ]
    out = await request_media(ctx, 136315, "tv", seasons=[1, 2])
    assert out["requested"] is False and out["reason"].startswith("Every season asked for")
    assert (await request_media(ctx, 136315, "tv", seasons=[]))["reason"] == (
        "No seasons were asked for."
    )


def test_season_plans():
    assert plan_seasons(BEAR, None, latest=True, is_4k=False).request == [3]
    assert plan_seasons(BEAR, [3, 3], latest=False, is_4k=False).request == [3]
    assert plan_seasons(BEAR, None, latest=False, is_4k=True).request == [1, 2, 3]
    with pytest.raises(ValueError, match="no season \\[7\\]"):
        plan_seasons(BEAR, [7], latest=False, is_4k=False)
    with pytest.raises(ValueError, match="not both"):
        plan_seasons(BEAR, [3], latest=True, is_4k=False)


async def test_seasons_are_refused_for_movies(ctx):
    seed(ctx, DUNE)
    with pytest.raises(ValueError, match="TV shows only"):
        await request_media(ctx, 438631, "movie", seasons=[1])


async def test_4k_goes_to_the_admin_with_the_size_tradeoff(ctx):
    seed(ctx, replace(DUNE, status=S.AVAILABLE))
    four_k_servers(ctx)
    radarr = ctx.services.radarr["meleys"]
    radarr.movie_list = [
        Movie(8, "Dune", 438631, 2021, "/Meleys/Movies/Dune (2021)", True, True, 55)
    ]
    radarr.files = [
        MediaFile(
            55, "/Meleys/Movies/Dune (2021)/Dune.mkv", 12_300_000_000, "Bluray-1080p", None, 8
        )
    ]
    out = await request_media_4k(ctx, 438631, "movie")
    assert isinstance(out, Result)
    assert out.content["requested"] is True and out.content["version"] == "4K"
    assert out.content["standard_copy_gb"] == 12.3 and out.content["estimated_4k_gb"] == "49-74"
    approval = out.approval
    assert approval.notice.startswith("dany asks for Dune (2021) in 4K (Seerr request #1).")
    assert "12.3 GB" in approval.notice and approval.decide == "decide_4k_request"
    assert approval.args == {"request_id": 1, "title": "Dune (2021)", "requester": "d1"}
    assert approval.summary == "4K Dune (2021) for dany"
    assert ctx.services.seerr.requests[0].is_4k


async def test_4k_without_a_4k_server_or_already_approved_needs_no_admin(ctx):
    seed(ctx, DUNE)
    out = await request_media_4k(ctx, 438631, "movie")
    assert out == {"requested": False, "reason": "4K requests aren't set up on this server."}
    four_k_servers(ctx)
    ctx.services.seerr.auto_approve = True
    out = await request_media_4k(ctx, 438631, "movie")
    assert out["requested"] is True and out["auto_approved"] is True and "standard_copy" not in out


async def test_decide_4k_request_approves_or_declines_in_seerr_and_tells_the_requester(ctx):
    seed(ctx, DUNE)
    four_k_servers(ctx)
    await request_media_4k(ctx, 438631, "movie")
    await request_media_4k(ctx, 438631, "movie")
    admin = replace(ctx, user_id="boss", tier=Tier.ADMIN)
    first = {"request_id": 1, "title": "Dune (2021)", "requester": "d1"}

    approved = await decide_4k_request(admin, approved=True, **first)
    assert approved.content == "Approved Dune (2021) in 4K in Seerr (request #1)."
    assert approved.notices == (
        DirectMessage("d1", "The admin approved Dune (2021) in 4K. It's on its way; I'll message you when it's ready."),
    )  # fmt: skip
    assert ctx.services.seerr.requests[0].status == RequestStatus.APPROVED

    # Pressed again after Seerr already applied it: same answer, and the friend still hears.
    assert await decide_4k_request(admin, approved=True, **first) == approved
    # Seerr went the other way in the meantime: say so, and tell nobody anything wrong.
    other_way = await decide_4k_request(admin, approved=False, **first)
    assert "already approved in Seerr" in other_way.content and other_way.notices == ()

    declined = await decide_4k_request(admin, approved=False, **{**first, "request_id": 2})
    assert declined.content.startswith("Declined") and "declined" in declined.notices[0].text
    assert ctx.services.seerr.requests[1].status == RequestStatus.DECLINED


def bear_in(ctx, *hosts):
    for host in hosts:
        ctx.services.sonarr[host].series_list = [
            Series(12, "The Bear", 403245, 2022, f"/{host}/TV/The Bear", False, "standard", (1, 2))
        ]


async def test_follow_show_only_on_the_owning_host(ctx):
    seed(ctx, BEAR)
    out = await follow_show(ctx, 136315, "vermithor")
    assert out["followed"] is False and "isn't in Sonarr yet" in out["reason"]
    bear_in(ctx, "vermithor")
    out = await follow_show(ctx, 136315, "meleys")
    assert out == {
        "followed": False,
        "reason": "The Bear (2022) is on the Sonarr on vermithor, not meleys.",
    }
    assert await follow_show(ctx, 136315, "Vermithor") == {
        "followed": True,
        "title": "The Bear (2022)",
        "host": "vermithor",
    }
    assert ctx.services.sonarr["vermithor"].followed == [12]
    bear_in(ctx, "meleys")
    out = await follow_show(ctx, 136315, "vermithor")
    assert out["followed"] is False and "meleys and vermithor both have it" in out["reason"]


def test_4k_is_a_trusted_tool_the_friend_tier_never_sees():
    friend = {s.name for s in registry.for_tier(Tier.FRIEND)}
    trusted = {s.name for s in registry.for_tier(Tier.TRUSTED)}
    assert {"search_media", "request_media", "follow_show"} <= friend
    assert "request_media_4k" not in friend and "request_media_4k" in trusted
    decide = registry.get("decide_4k_request")
    assert decide.button_only and decide.tier == Tier.ADMIN
    assert registry.get("follow_show").host_param == "host"


def sonarr_with_tags(ctx, *, is_4k=False, tags=((1, "seerr"), (4, "anime"), (7, "dub"))):
    options = ServerOptions(
        profiles=(Named(6, "HD-1080p"), Named(11, "Dual Audio")),
        tags=tuple(Named(i, label) for i, label in tags),
        default_tags=(1,),
        anime_tags=(1, 4),
    )
    ctx.services.seerr.arr_servers["sonarr"] = [seerr_server(0, "tv", "meleys", is_4k=is_4k)]
    ctx.services.seerr.options[("sonarr", 0)] = options


async def test_an_english_dub_request_carries_the_dub_tag_and_profile(ctx):
    seed(ctx, replace(BEAR, keyword_ids=frozenset({ANIME_KEYWORD})))
    sonarr_with_tags(ctx)
    ctx = replace(ctx, settings=replace(ctx.settings, dub_profile="dual audio"))
    out = await request_media(ctx, 136315, "tv", english_dub=True)
    assert out["requested"] is True and out["dub"] == {"tag": "dub", "profile": "Dual Audio"}
    routing = ctx.services.seerr.routed[1]
    assert (routing.server_id, routing.tags, routing.profile_id) == (0, (1, 4, 7), 11)


async def test_a_dub_request_keeps_default_tags_and_says_when_it_cannot_tag(ctx):
    seed(ctx, BEAR)
    sonarr_with_tags(ctx)
    out = await request_media(ctx, 136315, "tv", english_dub=True)
    assert out["dub"] == {"tag": "dub", "profile": None}
    assert ctx.services.seerr.routed[1].tags == (1, 7)

    sonarr_with_tags(ctx, tags=((1, "seerr"),))
    out = await request_media(ctx, 136315, "tv", seasons=[3], english_dub=True)
    assert out["requested"] is True and "has no 'dub' tag" in out["dub"]
    assert 2 not in ctx.services.seerr.routed

    ctx.services.seerr.arr_servers["sonarr"] = []
    out = await request_media(ctx, 136315, "tv", seasons=[3], english_dub=True)
    assert out["dub"].startswith("Seerr has no default server")


async def test_a_size_that_cannot_be_measured_does_not_block_4k(ctx):
    seed(ctx, replace(DUNE, status=S.AVAILABLE))
    four_k_servers(ctx)

    class Down:
        base_url = "http://meleys.lan:7878"

        async def movie_by_tmdb(self, tmdb_id):
            raise ClientError("radarr", "GET", "/api/v3/movie", None, "timeout")

    ctx.services.radarr["meleys"] = Down()
    out = await request_media_4k(ctx, 438631, "movie")
    assert isinstance(out, Result) and out.content["requested"] is True
    assert out.content["standard_copy_size"].startswith("unknown (couldn't ask the movie arr")
