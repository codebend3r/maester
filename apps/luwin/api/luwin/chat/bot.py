"""The discord.py client: DMs, mentions in the requests channel, reactions, slash commands.

Thin on purpose. Everything that decides what to say is in `service.py`, and
the admin's commands are `admin.py`'s.
The bot is also the app's `Notifier`: `deliver()` posts notices in the
admin channel or DMs them, whoever produced them (a reply, a button press,
a webhook), and hands every sent DM to the service to remember. A reaction
in a DM goes to the service, which decides whether it means anything.
Decision buttons are persistent: their custom ids carry the pending action,
so a press after a restart still lands.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Sequence

import discord
from discord import app_commands

from luwin.chat.admin import AdminConsole, AdminReply
from luwin.chat.members import resolve_chat_user
from luwin.chat.service import ChatService, ChatUser, reports_a_problem
from luwin.chat.split import split_reply
from luwin.chat.views import DecisionButton, decision_view, send_response, send_text
from luwin.notify import (
    AdminPost,
    Announcement,
    ApprovalPost,
    DirectMessage,
    Notice,
    RoleChange,
)

log = logging.getLogger("luwin.bot")


class LuwinBot(discord.Client):
    def __init__(
        self,
        service: ChatService,
        *,
        console: AdminConsole,
        guild_id: int,
        requests_channel_id: int,
        admin_channel_id: int,
    ):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True
        super().__init__(intents=intents)
        self.service = service
        self.console = console
        self.guild_id = guild_id
        self.requests_channel_id = requests_channel_id
        self.admin_channel_id = admin_channel_id
        self.tree = app_commands.CommandTree(self)
        # Set once the bot first connects: scheduled jobs wait on it so their
        # first notices have a channel to go to.
        self.online = asyncio.Event()
        self._register_commands()

    # -- lifecycle --------------------------------------------------------

    async def setup_hook(self) -> None:
        self.add_dynamic_items(DecisionButton)
        if self.guild_id:
            guild = discord.Object(id=self.guild_id)
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        else:
            await self.tree.sync()

    async def on_ready(self) -> None:
        log.info("luwin is online as %s", self.user)
        self.online.set()

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
        user = await resolve_chat_user(self, message.author)
        async with message.channel.typing():
            response = await self.service.handle_message(user, text)
        await send_response(message.channel, self, user, response)

    async def on_raw_reaction_add(self, payload: discord.RawReactionActionEvent) -> None:
        if payload.guild_id is not None or self.user is None or payload.user_id == self.user.id:
            return
        if not reports_a_problem(str(payload.emoji)):
            return
        author = self.get_user(payload.user_id) or await self.fetch_user(payload.user_id)
        user = await resolve_chat_user(self, author)
        response = await self.service.react(user, str(payload.message_id), str(payload.emoji))
        if response is not None:
            await send_response(await author.create_dm(), self, user, response)

    # -- notices ----------------------------------------------------------

    async def deliver(self, notices: Sequence[Notice]) -> list[Notice]:
        """Post admin notices (approvals get buttons) and send DMs, each on its own.

        Never raises: a notice that can't be sent is logged and returned.
        """
        failed = []
        for notice in notices:
            try:
                await self._send(notice)
            except Exception:
                log.exception("could not deliver %s", notice)
                failed.append(notice)
        return failed

    async def _send(self, notice: Notice) -> None:
        match notice:
            case AdminPost(text):
                await send_text(self._admin_channel(), text)
            case ApprovalPost(text, pending_id):
                # A long one is split, and the buttons go on its last part.
                *before, last = split_reply(text) or [""]
                channel = self._admin_channel()
                for chunk in before:
                    await channel.send(chunk)
                await channel.send(last, view=decision_view(pending_id, "approve"))
            case Announcement(text):
                await send_text(self._channel(self.requests_channel_id, "requests"), text)
            case RoleChange():
                await self._change_role(notice)
            case DirectMessage(to, text):
                user = self.get_user(int(to)) or await self.fetch_user(int(to))
                sent = await send_text(user, text)
                try:
                    for message in sent:
                        self.service.remember_dm(str(message.id), notice)
                except Exception:  # it was delivered; forgetting it only costs the reaction
                    log.exception("DM to %s sent but not remembered", to)

    async def _change_role(self, change: RoleChange) -> None:
        """Give or take a role; when Discord won't (the bot lacks Manage Roles, or the role
        sits above its own), the admin is told to do it by hand."""
        try:
            guild = self.get_guild(self.guild_id)
            if guild is None:
                raise LookupError("the bot isn't in the configured server")
            member = guild.get_member(int(change.to)) or await guild.fetch_member(int(change.to))
            role = discord.Object(id=change.role_id)
            edit = member.add_roles if change.add else member.remove_roles
            await edit(role, reason=change.why or "luwin")
        except (discord.HTTPException, LookupError) as exc:
            verb = "give" if change.add else "take away from"
            await send_text(
                self._admin_channel(),
                f"Couldn't {verb} <@{change.to}> the role <@&{change.role_id}> ({exc}); "
                "change it by hand in the server's settings.",
            )
            raise

    def _admin_channel(self) -> discord.abc.Messageable:
        return self._channel(self.admin_channel_id, "admin")

    def _channel(self, channel_id: int, name: str) -> discord.abc.Messageable:
        channel = self.get_channel(channel_id) if channel_id else None
        if channel is None:
            raise LookupError(f"no {name} channel is configured or visible to the bot")
        return channel  # type: ignore[return-value]

    # -- slash commands ---------------------------------------------------

    def _register_commands(self) -> None:
        tree = self.tree

        @tree.command(name="link", description="Link your Discord account to your Plex account")
        @app_commands.describe(account="The email or username you use for Plex")
        async def link(interaction: discord.Interaction, account: str) -> None:
            await interaction.response.defer(ephemeral=True)
            user = await resolve_chat_user(self, interaction.user)
            response = await self.service.link(user, account)
            await interaction.followup.send(response.text, ephemeral=True)
            await self.deliver(response.notices)

        @tree.command(
            name="whoami", description="Show which Plex account you're linked to and your tier"
        )
        async def whoami(interaction: discord.Interaction) -> None:
            user = await resolve_chat_user(self, interaction.user)
            await interaction.response.send_message(self.service.whoami(user), ephemeral=True)

        @tree.command(name="setup", description="How to set up Plex on your TV, stick or phone")
        @app_commands.describe(device="What you watch on")
        @app_commands.choices(
            device=[
                app_commands.Choice(name="Apple TV", value="apple_tv"),
                app_commands.Choice(name="Roku", value="roku"),
                app_commands.Choice(name="Fire TV", value="fire_tv"),
                app_commands.Choice(name="Android TV, Google TV, Shield", value="android_tv"),
                app_commands.Choice(name="iPhone, iPad, Android phone", value="mobile"),
                app_commands.Choice(name="Web browser", value="web"),
            ]
        )
        async def setup(interaction: discord.Interaction, device: app_commands.Choice[str]) -> None:
            await interaction.response.defer(ephemeral=True)
            for chunk in self.service.setup_guide(device.value):
                await interaction.followup.send(chunk, ephemeral=True)

        @tree.command(name="forget", description="Clear our conversation so far")
        async def forget(interaction: discord.Interaction) -> None:
            user = await resolve_chat_user(self, interaction.user)
            await interaction.response.send_message(self.service.forget(user), ephemeral=True)

        @tree.command(name="tier", description="Admin: set or clear a member's tier override")
        @app_commands.describe(
            member="Whose tier to change", tier="The tier to force, or 'from roles' to clear it"
        )
        @app_commands.choices(
            tier=[
                app_commands.Choice(name="friend", value="friend"),
                app_commands.Choice(name="trusted", value="trusted"),
                app_commands.Choice(name="admin", value="admin"),
                app_commands.Choice(name="from roles", value="roles"),
            ]
        )
        async def tier(
            interaction: discord.Interaction, member: discord.User, tier: app_commands.Choice[str]
        ) -> None:
            await interaction.response.defer(ephemeral=True)
            admin = await resolve_chat_user(self, interaction.user)
            value = None if tier.value == "roles" else tier.value
            await self._answer(interaction, self.console.set_tier(admin, str(member.id), value))

        @tree.command(name="kill", description="Admin: stop every destructive tool, or allow them")
        @app_commands.describe(
            state="on stops them, off lets them run", reason="Why; friends are told it"
        )
        @app_commands.choices(
            state=[
                app_commands.Choice(name="on", value="on"),
                app_commands.Choice(name="off", value="off"),
            ]
        )
        async def kill(
            interaction: discord.Interaction, state: app_commands.Choice[str], reason: str = ""
        ) -> None:
            await interaction.response.defer(ephemeral=True)
            admin = await resolve_chat_user(self, interaction.user)
            await self._answer(interaction, self.console.kill(admin, state.value == "on", reason))

        @tree.command(name="audit", description="Admin: the latest tool calls and commands")
        @app_commands.describe(n="How many rows (default 10, at most 50)")
        async def audit(interaction: discord.Interaction, n: int = 10) -> None:
            await interaction.response.defer(ephemeral=True)
            admin = await resolve_chat_user(self, interaction.user)
            await self._answer(interaction, self.console.audit(admin, n))

        @tree.command(name="pending", description="Admin: everything waiting on your decision")
        async def pending(interaction: discord.Interaction) -> None:
            await interaction.response.defer(ephemeral=True)
            admin = await resolve_chat_user(self, interaction.user)
            await self._answer(interaction, await self.console.pending(admin))

        @tree.command(name="forecast", description="Admin: when each volume fills at this rate")
        async def forecast(interaction: discord.Interaction) -> None:
            await interaction.response.defer(ephemeral=True)
            admin = await resolve_chat_user(self, interaction.user)
            await self._answer(interaction, self.console.forecast(admin))

        @tree.command(name="maintenance", description="Admin: start or end a maintenance window")
        @app_commands.describe(
            state="start holds requests and replacements; end runs them",
            message="What friends are told, when starting",
        )
        @app_commands.choices(
            state=[
                app_commands.Choice(name="start", value="start"),
                app_commands.Choice(name="end", value="end"),
            ]
        )
        async def maintenance(
            interaction: discord.Interaction, state: app_commands.Choice[str], message: str = ""
        ) -> None:
            await interaction.response.defer(ephemeral=True)
            admin = await resolve_chat_user(self, interaction.user)
            if state.value == "start":
                reply = self.console.start_maintenance(admin, message)
            else:
                reply = await self.console.end_maintenance(admin, self._member)
            await self._answer(interaction, reply)

    async def _member(self, discord_id: str) -> ChatUser:
        """Someone as the server knows them now, roles included."""
        user = self.get_user(int(discord_id)) or await self.fetch_user(int(discord_id))
        return await resolve_chat_user(self, user)

    async def _answer(self, interaction: discord.Interaction, reply: AdminReply) -> None:
        """An admin command's reply, privately, then each approval again with its buttons,
        its notices, and its DMs to friends. The notices and DMs go out even if the private
        reply can't (the interaction expired during a long `/maintenance end`)."""
        try:
            for chunk in split_reply(reply.text):
                await interaction.followup.send(chunk, ephemeral=True)
            for offer in reply.offers:
                view = decision_view(offer.id, offer.kind)
                await interaction.followup.send(offer.summary, view=view, ephemeral=True)
        except discord.HTTPException:
            log.exception("couldn't answer the admin's command")
        await self.deliver(reply.notices)
        for user_id, response in reply.dms:
            try:
                user = self.get_user(int(user_id)) or await self.fetch_user(int(user_id))
                friend = ChatUser(user_id, user.display_name)
                await send_response(await user.create_dm(), self, friend, response)
            except Exception:  # one friend's closed DMs mustn't keep the rest from hearing
                log.exception("couldn't DM %s after maintenance", user_id)
