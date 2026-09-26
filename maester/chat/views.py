"""discord.ui views: Confirm/Cancel, a choice picker, and Approve/Deny.

A DM author is a bare user with no roles, so `resolve_chat_user` looks the
member up in the server to keep their tier the same in DMs. Every view times out after five minutes (a week for link approvals) and
disables its buttons on timeout. The confirm and cancel buttons only answer
the user who asked; approve and deny only answer an admin. Those checks
live in the service so they hold whichever surface presses the button.
"""

from __future__ import annotations

from collections.abc import Sequence

import discord

from maester.chat.service import ChatResponse, ChatService, ChatUser, Choice
from maester.chat.split import split_reply

CONFIRM_TIMEOUT = 5 * 60
APPROVAL_TIMEOUT = 7 * 24 * 3600


def chat_user(user: discord.abc.User) -> ChatUser:
    roles = getattr(user, "roles", None) or []
    return ChatUser(
        id=str(user.id), name=user.display_name, role_ids=frozenset(r.id for r in roles)
    )


async def resolve_chat_user(client, user: discord.abc.User) -> ChatUser:
    """`chat_user`, with roles fetched from the server when `user` isn't a member."""
    if getattr(user, "roles", None):
        return chat_user(user)
    guild_id = getattr(client, "guild_id", 0)
    guild = client.get_guild(guild_id) if guild_id else None
    if guild is None:
        return chat_user(user)
    member = guild.get_member(user.id)
    if member is None:
        try:
            member = await guild.fetch_member(user.id)
        except discord.HTTPException:
            return chat_user(user)
    return chat_user(member)


class _AutoDisableView(discord.ui.View):
    message: discord.Message | None = None

    async def on_timeout(self) -> None:
        for item in self.children:
            if isinstance(item, discord.ui.Button):
                item.disabled = True
        if self.message:
            try:
                await self.message.edit(view=self)
            except discord.HTTPException:
                pass

    def _disable(self) -> None:
        for item in self.children:
            if isinstance(item, discord.ui.Button):
                item.disabled = True
        self.stop()


class ConfirmView(_AutoDisableView):
    def __init__(self, service: ChatService, pending_id: int):
        super().__init__(timeout=CONFIRM_TIMEOUT)
        self.service = service
        self.pending_id = pending_id

    @discord.ui.button(label="Confirm", style=discord.ButtonStyle.danger)
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await interaction.response.defer()
        user = await resolve_chat_user(interaction.client, interaction.user)
        text = await self.service.confirm(self.pending_id, user)
        self._disable()
        await interaction.edit_original_response(view=self)
        await interaction.followup.send(text)

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        user = await resolve_chat_user(interaction.client, interaction.user)
        text = await self.service.cancel(self.pending_id, user)
        self._disable()
        await interaction.response.edit_message(view=self)
        await interaction.followup.send(text)


class ChoiceView(_AutoDisableView):
    def __init__(self, service: ChatService, user: ChatUser, choices: Sequence[Choice]):
        super().__init__(timeout=CONFIRM_TIMEOUT)
        self.service = service
        self.user = user
        for n, choice in enumerate(choices[:5], 1):
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
        await interaction.response.defer()
        view._disable()
        await interaction.edit_original_response(view=view)
        response = await view.service.pick(view.user, self.choice)
        await send_response(interaction.followup, view.service, view.user, response)


class ApprovalView(_AutoDisableView):
    def __init__(self, service: ChatService, pending_id: int):
        super().__init__(timeout=APPROVAL_TIMEOUT)
        self.service = service
        self.pending_id = pending_id

    @discord.ui.button(label="Approve", style=discord.ButtonStyle.success)
    async def approve(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        user = await resolve_chat_user(interaction.client, interaction.user)
        text = await self.service.approve(self.pending_id, user)
        await self._finish(interaction, text)

    @discord.ui.button(label="Deny", style=discord.ButtonStyle.danger)
    async def deny(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        user = await resolve_chat_user(interaction.client, interaction.user)
        text = await self.service.deny(self.pending_id, user)
        await self._finish(interaction, text)

    async def _finish(self, interaction: discord.Interaction, text: str) -> None:
        if text.startswith("Only the admin"):
            await interaction.response.send_message(text, ephemeral=True)
            return
        self._disable()
        await interaction.response.edit_message(view=self)
        await interaction.followup.send(text)


async def send_response(
    target, service: ChatService, user: ChatUser, response: ChatResponse
) -> None:
    """Send a ChatResponse's chunks and attach the views it needs to the last one.

    `target` is anything with `.send()`: a channel, a DM, or a webhook followup.
    """
    chunks = response.chunks or ["(no reply)"]
    for chunk in chunks[:-1]:
        await target.send(chunk)
    view: discord.ui.View | None = None
    extras: dict = {}
    if response.confirmations:
        view = ConfirmView(service, response.confirmations[0].id)
    elif response.choices:
        view = ChoiceView(service, user, response.choices)
        extras["embeds"] = choice_embeds(response.choices)
    if view:
        extras["view"] = view
    message = await target.send(chunks[-1], **extras)
    if isinstance(view, _AutoDisableView) and isinstance(message, discord.Message):
        view.message = message
    for extra in response.confirmations[1:]:
        extra_view = ConfirmView(service, extra.id)
        extra_view.message = await target.send(f"Also waiting: {extra.summary}", view=extra_view)


def choice_embeds(choices: Sequence[Choice]) -> list[discord.Embed]:
    """One small card per option, numbered like its button, with the poster when known."""
    embeds = []
    for n, choice in enumerate(choices[:5], 1):
        embed = discord.Embed(title=f"{n}. {choice.display}"[:256])
        if choice.poster_url:
            embed.set_thumbnail(url=choice.poster_url)
        embeds.append(embed)
    return embeds


async def send_text(target, text: str) -> None:
    for chunk in split_reply(text):
        await target.send(chunk)
