from dataclasses import replace

import pytest

from luwin.access import invite_libraries, title_of
from luwin.agent.runner import ToolRunner
from luwin.agent.tools import Tier, registry
from luwin.clients import ClientError
from luwin.clients.wizarr import Library
from luwin.config import Access
from luwin.notify import ApprovalPost
from luwin.tools.invites import decide_invite, request_invite

LIBRARIES = [
    Library(1, "01. Movies", 10, "Meleys"),
    Library(2, "02. TV Shows", 10, "Meleys"),
    Library(3, "03. Movies 4K", 10, "Meleys"),
    Library(4, "90. Home Videos", 10, "Meleys"),
    Library(5, "07. Anime", 20, "Vermithor"),
    Library(6, "08. Old Stuff", 20, "Vermithor", enabled=False),
]


PUBLIC = Access(public_url="https://join.example")


@pytest.fixture
def trusted(ctx):
    ctx.services.wizarr.library_list = list(LIBRARIES)
    return replace(ctx, tier=Tier.TRUSTED, settings=replace(ctx.settings, access=PUBLIC))


def test_an_invite_shares_every_library_that_isnt_4k_private_or_disabled():
    names = [lib.name for lib in invite_libraries(LIBRARIES, Access())]
    assert names == ["01. Movies", "02. TV Shows", "07. Anime"]
    named = Access(libraries=("movies", "Home Videos", "03. Movies 4K"))
    # Named ones are shared as named, 4K too, but a private one never.
    assert [lib.id for lib in invite_libraries(LIBRARIES, named)] == [1, 3]
    assert title_of("07. Anime") == "Anime"


async def test_asking_for_an_invite_goes_to_the_admin_and_sends_nothing(trusted):
    out = await request_invite(trusted, "  my brother   Rhaegar ", "he lives with me")
    assert out.content == {"asked": True, "for": "my brother Rhaegar"}
    approval = out.approval
    assert approval.notice == "dany asks for a Plex invite for my brother Rhaegar: he lives with me"
    long = await request_invite(trusted, "Rhaegar", "x" * 5000)
    assert len(long.approval.notice) < 600  # a post that fits one message
    assert approval.decide == "decide_invite"
    assert approval.args == {"for_whom": "my brother Rhaegar", "requester": "d1"}
    assert approval.subject == "invite:d1:my brother rhaegar"
    assert trusted.services.wizarr.invites == []
    assert (await request_invite(trusted, "  ")).is_error


async def test_approved_the_link_goes_to_the_friend_with_its_dates(trusted):
    admin = replace(trusted, user_id="boss", tier=Tier.ADMIN)
    out = await decide_invite(admin, "Rhaegar", "d1", approved=True)
    wizarr = trusted.services.wizarr
    (invite,) = wizarr.invites
    assert wizarr.asked == [
        {"expires_in_days": 7, "duration": "35", "library_ids": [1, 2, 5], "server_ids": [10, 20]}
    ]
    link = f"https://join.example/j/{invite.code}"
    assert out.content["link"] == link and out.content["access"] == "35"
    assert out.content["libraries"] == (
        "01. Movies on Meleys, 02. TV Shows on Meleys, 07. Anime on Vermithor"
    )
    (dm,) = out.notices
    assert dm.to == "d1" and f"Send them this link: {link}\n" in dm.text
    assert "It works until" in dm.text and "(7 days)" in dm.text
    assert "their access lasts 35 days" in dm.text


async def test_the_configured_expiry_is_snapped_up_and_access_can_be_open_ended(trusted):
    access = replace(PUBLIC, invite_expires_days=10, access_days=0)
    settings = replace(trusted.settings, access=access)
    admin = replace(trusted, user_id="boss", tier=Tier.ADMIN, settings=settings)
    out = await decide_invite(admin, "Rhaegar", "d1", approved=True)
    assert trusted.services.wizarr.asked[0]["expires_in_days"] == 30
    assert out.content["access"] == "unlimited" and "(30 days)" in out.notices[0].text
    assert "doesn't end" in out.notices[0].text


async def test_denied_or_with_nothing_to_share_no_invite_is_made(trusted):
    admin = replace(trusted, user_id="boss", tier=Tier.ADMIN)
    denied = await decide_invite(admin, "Rhaegar", "d1", approved=False)
    assert denied.content == "No invite for Rhaegar." and "didn't approve" in denied.notices[0].text
    trusted.services.wizarr.library_list = [Library(4, "90. Home Videos", 10, "Meleys")]
    out = await decide_invite(admin, "Rhaegar", "d1", approved=True)
    assert out.is_error and not out.retryable and "check INVITE_SERVERS" in out.content
    (snag,) = out.notices  # the friend isn't left waiting on a DM that never comes
    assert snag.to == "d1" and "the admin will sort it out" in snag.text
    assert trusted.services.wizarr.invites == []


async def test_an_invite_wizarr_didnt_confirm_isnt_made_twice(trusted):
    admin = replace(trusted, user_id="boss", tier=Tier.ADMIN)

    async def timed_out(**kw):
        raise ClientError("wizarr", "POST", "/api/invitations", None, "read timeout")

    trusted.services.wizarr.create_invite = timed_out
    out = await decide_invite(admin, "Rhaegar", "d1", approved=True)
    assert out.is_error and not out.retryable and "Check its invitations" in out.content
    assert "the admin will sort it out" in out.notices[0].text


def test_an_invite_shares_only_from_the_servers_named():
    meleys = Access(servers=("meleys",))
    assert [lib.id for lib in invite_libraries(LIBRARIES, meleys)] == [1, 2]


async def test_the_link_is_on_wizarrs_public_address(trusted):
    admin = replace(trusted, user_id="boss", tier=Tier.ADMIN)
    lan = replace(admin, settings=replace(admin.settings, access=Access(),
                                          wizarr_url="http://192.168.50.2:5690"))  # fmt: skip
    out = await decide_invite(lan, "Rhaegar", "d1", approved=True)
    assert out.content["link"] == "http://192.168.50.2:5690/j/FAKE001"


async def test_the_whole_flow_through_the_runner(trusted, store):
    runner = ToolRunner(registry)
    asked = await runner.run(trusted, "request_invite", {"for_whom": "Rhaegar"})
    (post,) = asked.notices
    assert isinstance(post, ApprovalPost) and asked.content["status"] == "awaiting_admin_approval"
    again = await runner.run(trusted, "request_invite", {"for_whom": "rhaegar"})
    assert again.notices == ()  # asked about once
    admin = replace(trusted, user_id="boss", tier=Tier.ADMIN)
    pending = store.decide_pending(post.pending_id, "approved", "boss")
    done = await runner.run_decision(admin, pending, True)
    assert not done.is_error and len(trusted.services.wizarr.invites) == 1


def test_invites_are_for_trusted_friends_and_issuing_one_is_destructive():
    assert "request_invite" not in {s.name for s in registry.for_tier(Tier.FRIEND)}
    assert "request_invite" in {s.name for s in registry.for_tier(Tier.TRUSTED)}
    decide = registry.get("decide_invite")
    assert decide.button_only and decide.destructive and decide.tier == Tier.ADMIN
