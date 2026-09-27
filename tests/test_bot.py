from types import SimpleNamespace

import discord

from maester.chat.bot import MaesterBot
from maester.chat.service import ChatResponse
from maester.chat.views import DecisionButton
from maester.media import Copy, Titled
from maester.notify import AdminPost, Announcement, ApprovalPost, DirectMessage


class Inbox:
    def __init__(self, fail: bool = False):
        self.sent = []
        self.fail = fail

    async def send(self, content, **kwargs):
        if self.fail:
            raise discord.Forbidden(SimpleNamespace(status=403, reason="Forbidden"), "closed DMs")
        self.sent.append((content, kwargs))
        return SimpleNamespace(id=900 + len(self.sent))

    async def create_dm(self):
        return self


class Service:
    """The parts of `ChatService` the bot calls."""

    def __init__(self):
        self.remembered, self.reactions = [], []

    def remember_dm(self, message_id, dm):
        self.remembered.append((message_id, dm))

    async def react(self, user, message_id, emoji):
        self.reactions.append((user.id, message_id, emoji))
        return ChatResponse(["What's wrong with it?"]) if emoji == "\N{THUMBS DOWN SIGN}" else None


def bot_with(channel, users, requests=None):
    service = Service()
    bot = MaesterBot(service, guild_id=1, requests_channel_id=2, admin_channel_id=3)
    bot.get_channel = lambda i: {3: channel, 2: requests}.get(i)
    bot.get_user = lambda i: None
    bot.get_guild = lambda i: None

    async def fetch_user(i):
        return users[i]

    bot.fetch_user = fetch_user
    return bot


async def test_deliver_posts_and_dms_each_notice_and_returns_what_failed():
    admin, friend, closed = Inbox(), Inbox(), Inbox(fail=True)
    bot = bot_with(admin, {5: friend, 6: closed})
    unreachable = DirectMessage("6", "Nobody hears this")
    failed = await bot.deliver(
        [
            ApprovalPost("Pal wants Dune in 4K", 12),
            DirectMessage("5", "It's ready"),
            unreachable,
            AdminPost("FYI"),
        ]
    )
    assert failed == [unreachable]
    (asked, kwargs), (fyi, _) = admin.sent
    assert asked == "Pal wants Dune in 4K" and fyi == "FYI"
    buttons = kwargs["view"].children
    assert [b.item.custom_id for b in buttons] == ["decide:12:approve", "decide:12:deny"]
    assert all(isinstance(b, DecisionButton) for b in buttons)
    assert friend.sent == [("It's ready", {})]
    assert bot.service.remembered == [("901", DirectMessage("5", "It's ready"))]


async def test_without_an_admin_channel_admin_notices_fail_but_dms_still_go():
    friend = Inbox()
    bot = bot_with(None, {5: friend})
    post = AdminPost("FYI")
    assert await bot.deliver([post, DirectMessage("5", "hi")]) == [post]
    assert friend.sent == [("hi", {})]


def reaction(emoji, *, user_id=5, guild_id=None):
    return SimpleNamespace(
        guild_id=guild_id, user_id=user_id, message_id=77, emoji=emoji, channel_id=8
    )


async def test_a_dm_reaction_goes_to_the_service_and_its_answer_back_to_the_dm():
    friend = Inbox()
    friend.id, friend.display_name = 5, "Pal"
    bot = bot_with(None, {5: friend})
    bot._connection.user = SimpleNamespace(id=1)
    about = Titled(Copy("movie", 438631, True), "Dune (2021)")
    await bot.deliver([DirectMessage("5", "Dune is ready", about)])

    await bot.on_raw_reaction_add(reaction("\N{THUMBS DOWN SIGN}"))
    assert bot.service.reactions == [("5", "77", "\N{THUMBS DOWN SIGN}")]
    assert friend.sent[-1] == ("What's wrong with it?", {})

    # A thumbs-up means nothing, so nobody is even looked up for it.
    bot.fetch_user = None
    await bot.on_raw_reaction_add(reaction("\N{THUMBS UP SIGN}"))
    await bot.on_raw_reaction_add(reaction("\N{THUMBS DOWN SIGN}", guild_id=1))  # not a DM
    await bot.on_raw_reaction_add(reaction("\N{THUMBS DOWN SIGN}", user_id=1))  # the bot's own
    assert len(bot.service.reactions) == 1 and len(friend.sent) == 2


async def test_a_dm_that_went_out_is_delivered_even_if_it_cant_be_remembered():
    friend = Inbox()
    bot = bot_with(None, {5: friend})

    def broken(message_id, dm):
        raise OSError("disk full")

    bot.service.remember_dm = broken
    about = Titled(Copy("movie", 438631, True), "Dune (2021)")
    assert await bot.deliver([DirectMessage("5", "Dune is ready", about)]) == []
    assert friend.sent == [("Dune is ready", {})]


async def test_an_announcement_goes_to_the_requests_channel_for_everyone():
    admin, requests = Inbox(), Inbox()
    bot = bot_with(admin, {}, requests)
    assert await bot.deliver([Announcement("Down for maintenance")]) == []
    assert requests.sent == [("Down for maintenance", {})] and admin.sent == []
    no_channel = bot_with(admin, {})
    assert await no_channel.deliver([Announcement("x")]) == [Announcement("x")]
