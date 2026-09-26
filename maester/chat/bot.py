"""The discord.py client: DMs, mentions in the requests channel, slash commands.

Thin on purpose. Everything that decides what to say is in `service.py`.
"""

from __future__ import annotations

import logging
import re

import discord
from discord import app_commands

from maester.chat.service import ChatService
from maester.chat.views import ApprovalView, chat_user, send_response, send_text
from maester.store import PendingAction

log = logging.getLogger("maester.bot")


class MaesterBot(discord.Client):
    def __init__(
        self,
        service: ChatService,
        *,
        guild_id: int,
        requests_channel_id: int,
        admin_channel_id: int,
    ):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True
        super().__init__(intents=intents)
        self.service = service
        self.guild_id = guild_id
        self.requests_channel_id = requests_channel_id
        self.admin_channel_id = admin_channel_id
        self.tree = app_commands.CommandTree(self)
        self._register_commands()

    # -- lifecycle --------------------------------------------------------

    async def setup_hook(self) -> None:
        if self.guild_id:
            guild = discord.Object(id=self.guild_id)
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        else:
            await self.tree.sync()

    async def on_ready(self) -> None:
        log.info("maester is online as %s", self.user)

    # -- messages ---------------------------------------------------------

    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot or self.user is None:
            return
        is_dm = isinstance(message.channel, discord.DMChannel)
        mentioned = self.user in message.mentions
        in_requests = message.channel.id == self.requests_channel_id
        if not (is_dm or (in_requests and mentioned)):
            return
        text = re.sub(rf"<@!?{self.user.id}>", "", message.content).strip()
        if not text:
            text = "hello"
        user = chat_user(message.author)
        async with message.channel.typing():
            response = await self.service.handle_message(user, text)
        await send_response(message.channel, self.service, user, response)

    # -- admin notifications ----------------------------------------------

    async def notify_admin(self, text: str, pending: PendingAction | None) -> None:
        channel = self.get_channel(self.admin_channel_id) if self.admin_channel_id else None
        if channel is None:
            log.warning("no admin channel; dropped notification: %s", text[:120])
            return
        if pending is not None and pending.kind == "approve":
            view = ApprovalView(self.service, pending.id)
            view.message = await channel.send(text, view=view)
        else:
            await send_text(channel, text)

    # -- slash commands ---------------------------------------------------

    def _register_commands(self) -> None:
        tree = self.tree

        @tree.command(name="link", description="Link your Discord account to your Plex account")
        @app_commands.describe(account="The email or username you use for Plex")
        async def link(interaction: discord.Interaction, account: str) -> None:
            await interaction.response.defer(ephemeral=True)
            response = await self.service.link(chat_user(interaction.user), account)
            await interaction.followup.send(response.text, ephemeral=True)

        @tree.command(
            name="whoami", description="Show which Plex account you're linked to and your tier"
        )
        async def whoami(interaction: discord.Interaction) -> None:
            await interaction.response.send_message(
                self.service.whoami(chat_user(interaction.user)), ephemeral=True
            )

        @tree.command(name="forget", description="Clear our conversation so far")
        async def forget(interaction: discord.Interaction) -> None:
            await interaction.response.send_message(
                self.service.forget(chat_user(interaction.user)), ephemeral=True
            )
