"""The chat surface.

- `service.py`  platform-agnostic: takes a message, returns chunks, buttons, notices
- `identity.py` who a chat account is, and which tier they get
- `split.py`    breaks long replies at paragraph boundaries
- `members.py`  a Discord user or member as a `ChatUser`, roles included
- `views.py`    discord.ui buttons (confirm/cancel, approve/deny, pick)
- `bot.py`      the discord.py client: events, slash commands, admin channel
"""
