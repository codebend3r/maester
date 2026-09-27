"""discord.ui views: Confirm/Cancel or Approve/Deny, and a choice picker.

Views reach the service through `interaction.client`, the running
`MaesterBot`.

Confirm/Cancel buttons time out after five minutes, Approve/Deny after a
week, and both disable themselves when they do. Who may press a decision
button is the service's call; a refused press is answered privately and
leaves the buttons live for the person who may press them.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING

import discord

from maester.agent.tools import Choice
from maester.chat.members import resolve_chat_user
from maester.chat.service import ChatResponse, ChatUser
from maester.chat.split import split_reply
from maester.store import PendingAction

if TYPE_CHECKING:
    from maester.chat.bot import MaesterBot

CONFIRM_TIMEOUT = 5 * 60
APPROVAL_TIMEOUT = 7 * 24 * 3600

# Per pending-action kind: the approve button, the deny button, the timeout.
DECISION_BUTTONS = {
    "confirm": (
        ("Confirm", discord.ButtonStyle.danger),
        ("Cancel", discord.ButtonStyle.secondary),
        CONFIRM_TIMEOUT,
    ),
    "approve": (
        ("Approve", discord.ButtonStyle.success),
        ("Deny", discord.ButtonStyle.danger),
        APPROVAL_TIMEOUT,
    ),
}


class _AutoDisableView(discord.ui.View):
    message: discord.Message | None = None

    def _disable_buttons(self) -> None:
        for item in self.children:
            if isinstance(item, discord.ui.Button):
                item.disabled = True

    def _finish(self) -> None:
        self._disable_buttons()
        self.stop()

    async def on_timeout(self) -> None:
        self._disable_buttons()
        if self.message:
            try:
                await self.message.edit(view=self)
            except discord.HTTPException:
                pass


class DecisionView(_AutoDisableView):
    """Two buttons that settle one pending action through `ChatService.decide`."""

    def __init__(self, pending: PendingAction):
        yes, no, timeout = DECISION_BUTTONS[pending.kind]
        super().__init__(timeout=timeout)
        self.pending_id = pending.id
        self.add_item(_DecisionButton(*yes, approve=True))
        self.add_item(_DecisionButton(*no, approve=False))


class _DecisionButton(discord.ui.Button):
    def __init__(self, label: str, style: discord.ButtonStyle, *, approve: bool):
        super().__init__(label=label, style=style)
        self.approve = approve

    async def callback(self, interaction: discord.Interaction) -> None:
        view: DecisionView = self.view  # type: ignore[assignment]
        bot: MaesterBot = interaction.client  # type: ignore[assignment]
        await interaction.response.defer()
        user = await resolve_chat_user(bot, interaction.user)
        decision = await bot.service.decide(view.pending_id, user, self.approve)
        if not decision.settled:
            await interaction.followup.send(decision.text, ephemeral=True)
            return
        view._finish()
        await interaction.edit_original_response(view=view)
        await interaction.followup.send(decision.text)
        await bot.deliver(decision.notices)


class ChoiceView(_AutoDisableView):
    def __init__(self, user: ChatUser, choices: Sequence[Choice]):
        super().__init__(timeout=CONFIRM_TIMEOUT)
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


class _ChoiceButton(discord.ui.Button):
    def __init__(self, n: int, choice: Choice):
        super().__init__(label=f"{n}. {choice.display}"[:80], style=discord.ButtonStyle.primary)
        self.choice = choice

    async def callback(self, interaction: discord.Interaction) -> None:
        view: ChoiceView = self.view  # type: ignore[assignment]
        bot: MaesterBot = interaction.client  # type: ignore[assignment]
        await interaction.response.defer()
        view._finish()
        await interaction.edit_original_response(view=view)
        response = await bot.service.pick(view.user, self.choice)
        await send_response(interaction.followup, bot, view.user, response)


async def send_response(target, bot: MaesterBot, user: ChatUser, response: ChatResponse) -> None:
    """Send a ChatResponse's chunks with its views on the last one, then its notices.

    `target` is anything with `.send()`: a channel, a DM, or a webhook followup.
    """
    chunks = response.chunks or ["(no reply)"]
    for chunk in chunks[:-1]:
        await target.send(chunk)
    view: _AutoDisableView | None = None
    extras: dict = {}
    if response.confirmations:
        view = DecisionView(response.confirmations[0])
    elif response.choices:
        view = ChoiceView(user, response.choices)
        extras["embeds"] = choice_embeds(response.choices)
    if view:
        extras["view"] = view
    message = await target.send(chunks[-1], **extras)
    if view and isinstance(message, discord.Message):
        view.message = message
    for extra in response.confirmations[1:]:
        extra_view = DecisionView(extra)
        extra_view.message = await target.send(f"Also waiting: {extra.summary}", view=extra_view)
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


async def send_text(target, text: str) -> None:
    for chunk in split_reply(text):
        await target.send(chunk)
