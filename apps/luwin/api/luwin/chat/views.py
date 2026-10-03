"""discord.ui components: Confirm/Cancel or Approve/Deny buttons, and a choice picker.

Components reach the service through `interaction.client`, the running
`MaesterBot`.

Decision buttons are persistent. Their custom id, `decide:<pending id>:
<approve|deny>`, is all a press needs, and `DecisionButton` is registered
with the client at startup, so a week-long approval survives a deploy.
Expiry is the pending action's own (`decide_pending` refuses a late press),
not the view's. Who may press is the service's call; a refused press is
answered privately and leaves the buttons live. A settled press removes
them. The choice picker is ephemeral: its buttons time out after five
minutes and disable themselves.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from re import Match
from typing import TYPE_CHECKING, Any

import discord

from maester.agent.tools import Choice
from maester.chat.members import resolve_chat_user
from maester.chat.service import ChatResponse, ChatUser
from maester.chat.split import split_reply

if TYPE_CHECKING:
    from maester.chat.bot import MaesterBot

PICK_TIMEOUT = 5 * 60
# A decision button's custom id: which pending action, and which way.
DECIDE_ID = re.compile(r"decide:(?P<id>\d+):(?P<verdict>approve|deny)")

# Per pending-action kind: the approve button and the deny button.
DECISION_BUTTONS = {
    "confirm": (("Confirm", discord.ButtonStyle.danger), ("Cancel", discord.ButtonStyle.secondary)),
    "approve": (("Approve", discord.ButtonStyle.success), ("Deny", discord.ButtonStyle.danger)),
}


class DecisionButton(
    discord.ui.DynamicItem[discord.ui.Button],
    template=DECIDE_ID,
):
    """One side of a decision, settling a pending action through `ChatService.decide`."""

    def __init__(self, pending_id: int, approve: bool, label: str, style: discord.ButtonStyle):
        verdict = "approve" if approve else "deny"
        super().__init__(
            discord.ui.Button(label=label, style=style, custom_id=f"decide:{pending_id}:{verdict}")
        )
        self.pending_id, self.approve = pending_id, approve

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: discord.ui.Button, match: Match[str], /
    ) -> DecisionButton:
        return cls(int(match["id"]), match["verdict"] == "approve", item.label or "", item.style)

    async def callback(self, interaction: discord.Interaction) -> Any:
        bot: MaesterBot = interaction.client  # type: ignore[assignment]
        await interaction.response.defer()
        user = await resolve_chat_user(bot, interaction.user)
        decision = await bot.service.decide(self.pending_id, user, self.approve)
        if not decision.settled:
            await interaction.followup.send(decision.text, ephemeral=True)
            return
        await interaction.edit_original_response(view=None)
        # A press on a private copy (from /pending) is answered privately too.
        private = bool(interaction.message and interaction.message.flags.ephemeral)
        await interaction.followup.send(decision.text, ephemeral=private)
        await bot.deliver(decision.notices)


def decision_view(pending_id: int, kind: str) -> discord.ui.View:
    (yes, yes_style), (no, no_style) = DECISION_BUTTONS[kind]
    view = discord.ui.View(timeout=None)
    view.add_item(DecisionButton(pending_id, True, yes, yes_style))
    view.add_item(DecisionButton(pending_id, False, no, no_style))
    return view


class ChoiceView(discord.ui.View):
    message: discord.Message | None = None

    def __init__(self, user: ChatUser, choices: Sequence[Choice]):
        super().__init__(timeout=PICK_TIMEOUT)
        self.user = user
        for n, choice in enumerate(choices, 1):
            self.add_item(_ChoiceButton(n, choice))

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if str(interaction.user.id) != self.user.id:
            await interaction.response.send_message(
                "Those options are for someone else.", ephemeral=True
            )
            return False
        return True

    def finish(self) -> None:
        self._disable_buttons()
        self.stop()

    async def on_timeout(self) -> None:
        self._disable_buttons()
        if self.message:
            try:
                await self.message.edit(view=self)
            except discord.HTTPException:
                pass

    def _disable_buttons(self) -> None:
        for item in self.children:
            if isinstance(item, discord.ui.Button):
                item.disabled = True


class _ChoiceButton(discord.ui.Button):
    def __init__(self, n: int, choice: Choice):
        super().__init__(label=f"{n}. {choice.display}"[:80], style=discord.ButtonStyle.primary)
        self.choice = choice

    async def callback(self, interaction: discord.Interaction) -> None:
        view: ChoiceView = self.view  # type: ignore[assignment]
        bot: MaesterBot = interaction.client  # type: ignore[assignment]
        await interaction.response.defer()
        view.finish()
        await interaction.edit_original_response(view=view)
        response = await bot.service.pick(view.user, self.choice)
        await send_response(interaction.followup, bot, view.user, response)


async def send_response(target, bot: MaesterBot, user: ChatUser, response: ChatResponse) -> None:
    """Send a ChatResponse's chunks with its buttons on the last one, then its notices.

    `target` is anything with `.send()`: a channel, a DM, or a webhook followup.
    Delivery never raises, so notices always get their try after the reply.
    """
    chunks = response.chunks or ["(no reply)"]
    for chunk in chunks[:-1]:
        await target.send(chunk)
    extras: dict = {}
    choices: ChoiceView | None = None
    if response.confirmations:
        first = response.confirmations[0]
        extras["view"] = decision_view(first.id, first.kind)
    elif response.choices:
        choices = ChoiceView(user, response.choices)
        extras["view"] = choices
        extras["embeds"] = choice_embeds(response.choices)
    message = await target.send(chunks[-1], **extras)
    if choices and isinstance(message, discord.Message):
        choices.message = message
    for extra in response.confirmations[1:]:
        await target.send(
            f"Also waiting: {extra.summary}", view=decision_view(extra.id, extra.kind)
        )
    await bot.deliver(response.notices)


def choice_embeds(choices: Sequence[Choice]) -> list[discord.Embed]:
    """One small card per option, numbered like its button, with its detail and poster."""
    embeds = []
    for n, choice in enumerate(choices, 1):
        embed = discord.Embed(
            title=f"{n}. {choice.display}"[:256], description=choice.detail or None
        )
        if choice.poster_url:
            embed.set_thumbnail(url=choice.poster_url)
        embeds.append(embed)
    return embeds


async def send_text(target, text: str) -> list[discord.Message]:
    """Send `text` in as many messages as it takes; returns them."""
    return [await target.send(chunk) for chunk in split_reply(text)]
