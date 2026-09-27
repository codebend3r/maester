"""Turns a Discord user into the `ChatUser` the service works with.

A DM author is a bare user with no roles, so `resolve_chat_user` looks the
member up in the server to keep their tier the same in DMs.
"""

from __future__ import annotations

import discord

from maester.chat.service import ChatUser


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
