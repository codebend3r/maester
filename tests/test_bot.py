from types import SimpleNamespace

import discord

from maester.chat.bot import MaesterBot
from maester.chat.views import DecisionButton
from maester.notify import AdminPost, ApprovalPost, DirectMessage


class Inbox:
    def __init__(self, fail: bool = False):
        self.sent = []
        self.fail = fail

    async def send(self, content, **kwargs):
        if self.fail:
            raise discord.Forbidden(SimpleNamespace(status=403, reason="Forbidden"), "closed DMs")
        self.sent.append((content, kwargs))
        return None


def bot_with(channel, users):
    bot = MaesterBot(SimpleNamespace(), guild_id=1, requests_channel_id=2, admin_channel_id=3)
    bot.get_channel = lambda i: channel if i == 3 else None
    bot.get_user = lambda i: None

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


async def test_without_an_admin_channel_admin_notices_fail_but_dms_still_go():
    friend = Inbox()
    bot = bot_with(None, {5: friend})
    post = AdminPost("FYI")
    assert await bot.deliver([post, DirectMessage("5", "hi")]) == [post]
    assert friend.sent == [("hi", {})]
