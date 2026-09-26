"""The chat surface.

- `service.py`  platform-agnostic: takes a message, returns chunks, buttons
- `identity.py` who a chat account is, and which tier they get
- `split.py`    breaks long replies at paragraph boundaries
- `views.py`    discord.ui buttons (confirm, pick, approve)
- `bot.py`      the discord.py client: events and slash commands
"""
