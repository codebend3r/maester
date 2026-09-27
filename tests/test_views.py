from types import SimpleNamespace

import discord

from maester.agent.tools import Choice
from maester.chat.service import ChatResponse
from maester.chat.views import ChoiceView, resolve_chat_user, send_response


def role(i):
    return SimpleNamespace(id=i)


class FakeGuild:
    def __init__(self, members=None, fetched=None):
        self.members = members or {}
        self.fetched = fetched or {}

    def get_member(self, user_id):
        return self.members.get(user_id)

    async def fetch_member(self, user_id):
        if user_id not in self.fetched:
            raise discord.NotFound(SimpleNamespace(status=404, reason="Not Found"), "unknown")
        return self.fetched[user_id]


def client_with(guild, guild_id=99):
    return SimpleNamespace(guild_id=guild_id, get_guild=lambda i: guild if i == guild_id else None)


DM_AUTHOR = SimpleNamespace(id=5, display_name="Pal")


async def test_member_roles_are_used_as_is():
    member = SimpleNamespace(id=5, display_name="Pal", roles=[role(1), role(2)])
    user = await resolve_chat_user(client_with(FakeGuild()), member)
    assert user.id == "5" and user.role_ids == {1, 2}


async def test_dm_author_gets_roles_from_the_cached_guild_member():
    member = SimpleNamespace(id=5, display_name="Pal", roles=[role(2)])
    user = await resolve_chat_user(client_with(FakeGuild(members={5: member})), DM_AUTHOR)
    assert user.role_ids == {2}


async def test_dm_author_falls_back_to_fetching_the_member():
    member = SimpleNamespace(id=5, display_name="Pal", roles=[role(1)])
    user = await resolve_chat_user(client_with(FakeGuild(fetched={5: member})), DM_AUTHOR)
    assert user.role_ids == {1}


async def test_dm_author_outside_the_guild_has_no_roles():
    user = await resolve_chat_user(client_with(FakeGuild()), DM_AUTHOR)
    assert user.role_ids == frozenset() and user.name == "Pal"
    user = await resolve_chat_user(client_with(None, guild_id=0), DM_AUTHOR)
    assert user.role_ids == frozenset()


class FakeTarget:
    def __init__(self):
        self.sent = []

    async def send(self, content, **kwargs):
        self.sent.append((content, kwargs))
        return None


async def test_choices_render_numbered_buttons_and_poster_embeds():
    target = FakeTarget()
    user = SimpleNamespace(id="5")
    response = ChatResponse(
        chunks=["Which one?"],
        choices=[
            Choice("Dune", "438631", 2021, "https://image.tmdb.org/t/p/w92/dune.jpg"),
            Choice("Dune", "841", 1984),
        ],
    )
    await send_response(target, None, user, response)
    ((content, kwargs),) = target.sent
    assert content == "Which one?"
    view = kwargs["view"]
    assert isinstance(view, ChoiceView)
    assert [b.label for b in view.children] == ["1. Dune (2021)", "2. Dune (1984)"]
    embeds = kwargs["embeds"]
    assert [e.title for e in embeds] == ["1. Dune (2021)", "2. Dune (1984)"]
    assert embeds[0].thumbnail.url == "https://image.tmdb.org/t/p/w92/dune.jpg"
    assert embeds[1].thumbnail.url is None
