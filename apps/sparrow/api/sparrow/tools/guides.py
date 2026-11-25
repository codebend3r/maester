"""Setting up raven in a browser or on a Mac: answered from sparrow's own guides.

The guides (`sparrow/guides/`) are the source, so the model relays them
instead of recalling menus from memory.
"""

from __future__ import annotations

from typing import Any

from sparrow.agent.tools import Tier, ToolContext, tool
from sparrow.guides import Device, guide


@tool(
    "setup_guide",
    "How to set up raven and get the best picture: signing up and in, installing Raven on "
    "a Mac, the player's Quality menu, a connection too slow for the file, audio and "
    "subtitles. Use it for any setup or player-settings question and answer from it, not "
    "from memory. device: web (raven in a browser) or mac (Raven, the Mac app, which plays "
    "every file as it is).",
    tier=Tier.FRIEND,
)
async def setup_guide(ctx: ToolContext, device: Device) -> dict[str, Any]:
    return {
        "device": device,
        "guide": guide(device),
        "note": "Answer from this guide, in a few steps; give the part they asked about. "
        "Menu names can change between versions, so say where else to look if it isn't there.",
    }
