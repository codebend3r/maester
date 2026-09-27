from types import SimpleNamespace

import discord

from maester.agent.tools import Choice
from maester.chat.members import resolve_chat_user
from maester.chat.service import ChatResponse, Decision
from maester.chat.views import (
    DECIDE_ID,
    ChoiceView,
    DecisionButton,
    decision_view,
    send_response,
)
from maester.notify import AdminPost


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


class FakeBot:
    """The bits of `MaesterBot` the views use."""

    guild_id = 0

    def __init__(self, decision=None, log=None):
        self.decision = decision
        self.log = log if log is not None else []
        self.pressed = []
        self.service = SimpleNamespace(decide=self._decide)

    async def _decide(self, pending_id, user, approve):
        self.pressed.append((pending_id, user.id, approve))
        return self.decision

    async def deliver(self, notices):
        self.log.append(("deliver", list(notices)))
        return []


class FakeInteraction:
    def __init__(self, bot, user):
        self.client = bot
        self.user = user
        self.response = SimpleNamespace(defer=self._defer)
        self.followup = FakeTarget()
        self.edits = []

    async def _defer(self):
        pass

    async def edit_original_response(self, **kwargs):
        self.edits.append(kwargs)


async def test_a_refused_press_is_answered_privately_and_keeps_the_buttons_live():
    confirm, _ = decision_view(1, "confirm").children
    bot = FakeBot(Decision("Only the person who asked can confirm this.", settled=False))
    interaction = FakeInteraction(bot, DM_AUTHOR)
    await confirm.callback(interaction)
    assert bot.pressed == [(1, "5", True)]
    assert interaction.followup.sent == [
        ("Only the person who asked can confirm this.", {"ephemeral": True})
    ]
    assert interaction.edits == [] and bot.log == []


async def test_a_settled_press_removes_the_buttons_replies_then_delivers():
    notice = AdminPost("Pal confirmed: replace it")
    _, cancel = decision_view(7, "approve").children
    bot = FakeBot(Decision("Denied", notices=(notice,)))
    interaction = FakeInteraction(bot, DM_AUTHOR)
    await cancel.callback(interaction)
    assert bot.pressed == [(7, "5", False)]
    assert interaction.edits == [{"view": None}]
    assert interaction.followup.sent == [("Denied", {})]
    assert bot.log == [("deliver", [notice])]


async def test_decision_buttons_are_persistent_and_follow_the_kind():
    confirm = decision_view(3, "confirm")
    assert confirm.timeout is None
    assert [b.item.label for b in confirm.children] == ["Confirm", "Cancel"]
    assert [b.item.label for b in decision_view(3, "approve").children] == ["Approve", "Deny"]
    button = discord.ui.Button(label="Approve", custom_id="decide:42:approve")
    match = DECIDE_ID.fullmatch("decide:42:approve")
    rebuilt = await DecisionButton.from_custom_id(None, button, match)
    assert (rebuilt.pending_id, rebuilt.approve, rebuilt.item.label) == (42, True, "Approve")


async def test_the_reply_goes_out_before_its_notices():
    target = FakeTarget()
    log = []
    bot = FakeBot(log=log)

    async def send(content, **kwargs):
        log.append(("send", content))

    target.send = send
    notice = AdminPost("heads up")
    await send_response(
        target, bot, SimpleNamespace(id="5"), ChatResponse(["Done."], notices=(notice,))
    )
    assert log == [("send", "Done."), ("deliver", [notice])]


async def test_choices_render_numbered_buttons_and_poster_embeds():
    target = FakeTarget()
    user = SimpleNamespace(id="5")
    response = ChatResponse(
        chunks=["Which one?"],
        choices=[
            Choice(
                "Dune", "438631", 2021, "https://image.tmdb.org/t/p/w92/dune.jpg", "On the server"
            ),
            Choice("Dune", "841", 1984),
        ],
    )
    bot = FakeBot()
    await send_response(target, bot, user, response)
    ((content, kwargs),) = target.sent
    assert content == "Which one?"
    view = kwargs["view"]
    assert isinstance(view, ChoiceView)
    assert [b.label for b in view.children] == ["1. Dune (2021)", "2. Dune (1984)"]
    embeds = kwargs["embeds"]
    assert [e.title for e in embeds] == ["1. Dune (2021)", "2. Dune (1984)"]
    assert embeds[0].thumbnail.url == "https://image.tmdb.org/t/p/w92/dune.jpg"
    assert embeds[0].description == "On the server" and embeds[1].description is None
    assert embeds[1].thumbnail.url is None
