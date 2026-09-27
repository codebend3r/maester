from types import SimpleNamespace

import discord

from maester.chat.bot import MaesterBot
from maester.chat.views import DecisionView
from maester.notify import Notice
from maester.store import PendingAction


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


async def test_deliver_posts_admin_notices_and_dms_users():
    admin, friend, closed = Inbox(), Inbox(), Inbox(fail=True)
    bot = bot_with(admin, {5: friend, 6: closed})
    pending = PendingAction(1, "approve", "request_media_4k", "5", {}, "4K Dune", None, "2099")
    await bot.deliver(
        [
            Notice("Pal wants Dune in 4K", approval=pending),
            Notice("It's ready", to="5"),
            Notice("Nobody hears this", to="6"),
            Notice("FYI"),
        ]
    )
    (asked, kwargs), (fyi, _) = admin.sent
    assert asked == "Pal wants Dune in 4K" and isinstance(kwargs["view"], DecisionView)
    assert fyi == "FYI"
    assert friend.sent == [("It's ready", {})]
