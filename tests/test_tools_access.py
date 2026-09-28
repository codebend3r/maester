from dataclasses import replace

import pytest

from maester.agent.tools import Result, Tier, registry
from maester.clients.plextv import OwnedServer, Section, Share
from maester.notify import DirectMessage, RoleChange
from maester.tools.access import decide_access, request_access

MELEYS, VERMITHOR = OwnedServer("Meleys", "m-1"), OwnedServer("Vermithor", "v-1")


@pytest.fixture
def friend(ctx):
    """dany, shared Movies and TV on Meleys; Vermithor has Anime and is shared with nobody."""
    ctx.store.upsert_user("d1", plex_email="dany@example.com")
    plextv = ctx.services.plextv
    plextv.owned = [MELEYS, VERMITHOR]
    plextv.libraries = {
        "m-1": [
            Section(101, "01. Movies"),
            Section(102, "02. TV Shows"),
            Section(103, "03. Movies 4K"),
            Section(104, "04. Anime"),
            Section(190, "90. Home Videos"),
        ],
        "v-1": [Section(201, "05. Documentaries"), Section(202, "06. TV 4K")],
    }
    plextv.shared = {
        "m-1": [
            Share(7, "m-1", "Dany@Example.com", "dany", False, frozenset({101, 102})),
            Share(8, "m-1", "pal@example.com", "pal", True, frozenset()),
        ]
    }
    return ctx


async def test_asking_for_a_library_checks_it_then_goes_to_the_admin(friend):
    out = await request_access(friend, "library", "anime", "for the kids")
    assert out.content == {"asked": True, "change": "library", "library": "Anime"}
    approval = out.approval
    assert approval.notice == "dany asks for the Anime library: for the kids"
    assert approval.args == {"change": "library", "library": "Anime", "requester": "d1"}
    assert approval.subject == "access:d1:library:anime" and approval.decide == "decide_access"
    assert friend.services.plextv.written == []


@pytest.mark.parametrize(
    ("library", "why"),
    [
        ("Movies", "You already have Movies."),
        ("Home Videos", "There's no library called Home Videos on the server."),  # private
        ("Cartoons", "There's no library called Cartoons on the server."),
        ("Documentaries", "Documentaries is on a server you aren't shared yet; that takes an "
                          "invite, so ask the admin."),
        ("", "Say which library."),
    ],
)  # fmt: skip
async def test_an_ask_that_makes_no_sense_is_refused_before_the_admin_sees_it(friend, library, why):
    assert await request_access(friend, "library", library) == Result.refusal(why)


async def test_approved_the_library_is_added_to_the_share_and_nothing_else_changes(friend):
    admin = replace(friend, user_id="boss", tier=Tier.ADMIN)
    out = await decide_access(admin, "library", "Anime", "d1", approved=True)
    assert friend.services.plextv.written == [(7, [101, 102, 104])]
    assert out.content == "Added 04. Anime on Meleys for dany."
    (dm,) = out.notices
    assert dm.to == "d1" and dm.text.startswith("The admin added Anime to your Plex access.")
    # Pressed again: already there, nothing written twice.
    again = await decide_access(admin, "library", "Anime", "d1", approved=True)
    assert len(friend.services.plextv.written) == 1 and "nothing new" in again.content


async def test_4k_adds_the_4k_libraries_and_the_trusted_role(friend):
    friend = replace(friend, settings=replace(friend.settings, discord_role_trusted=22))
    asked = await request_access(friend, "4k")
    assert asked.approval.notice == "dany asks for 4K (4K requests and the 4K libraries)."
    admin = replace(friend, user_id="boss", tier=Tier.ADMIN)
    out = await decide_access(admin, "4k", "4K", "d1", approved=True)
    assert friend.services.plextv.written == [(7, [101, 102, 103])]
    role, dm = out.notices
    assert role == RoleChange("d1", 22, why="4K approved in maester")
    assert dm == DirectMessage(
        "d1",
        "The admin approved 4K for you: ask me for any title in 4K now. The 4K libraries show "
        "up in the Plex app in a few minutes.",
    )
    assert out.content == "Added 03. Movies 4K on Meleys and the trusted role for dany."


async def test_a_trusted_friend_with_every_4k_library_already_has_4k(friend):
    trusted = replace(friend, tier=Tier.TRUSTED)
    friend.services.plextv.shared["m-1"][0] = replace(
        friend.services.plextv.shared["m-1"][0], all_libraries=True
    )
    assert await request_access(trusted, "4k") == Result.refusal(
        "You already have 4K: ask me for any title in 4K."
    )


async def test_denied_or_not_set_up_nothing_changes(friend):
    admin = replace(friend, user_id="boss", tier=Tier.ADMIN)
    out = await decide_access(admin, "library", "Anime", "d1", approved=False)
    assert out.notices == (
        DirectMessage("d1", "The admin didn't add Anime to your access for now."),
    )
    friend.services.plextv = None
    assert (await request_access(friend, "library", "Anime")).is_error
    assert (await decide_access(admin, "library", "Anime", "d1", approved=True)).is_error


async def test_someone_on_no_server_is_told_to_ask_for_an_invite(friend):
    friend.store.upsert_user("d1", plex_email="new@example.com", plex_username="newbie")
    out = await request_access(friend, "library", "Anime")
    assert out.is_error and "isn't shared any server yet" in out.content


def test_access_changes_are_the_admins_to_make():
    assert registry.get("request_access").tier == Tier.FRIEND
    decide = registry.get("decide_access")
    assert decide.button_only and decide.destructive and decide.tier == Tier.ADMIN
