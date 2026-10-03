"""Setting up a TV, stick, phone or browser: answered from luwin's own guides.

The guides (`luwin/guides/`) are the source, so the model relays them
instead of recalling menus from memory; anyone, linked or not, reads the
same text through `/setup`.
"""

from __future__ import annotations

from typing import Any

from luwin.agent.tools import Tier, ToolContext, tool
from luwin.guides import DEVICES, guide


@tool(
    "setup_guide",
    "How to set up Plex on a device and get the best picture: installing and signing in, "
    "finding the server's libraries, quality at home and away, the relay, Direct Play, "
    "subtitles and sound. Use it for any setup or app-settings question and answer from it, "
    "not from memory. device: apple_tv, roku, fire_tv, android_tv (Google TV, Nvidia "
    "Shield), mobile (iPhone, iPad, Android phones) or web (a browser, or a computer).",
    {
        "type": "object",
        "properties": {"device": {"type": "string", "enum": sorted(DEVICES)}},
        "required": ["device"],
        "additionalProperties": False,
    },
    tier=Tier.FRIEND,
)
async def setup_guide(ctx: ToolContext, device: str) -> dict[str, Any]:
    return {
        "device": device,
        "guide": guide(device),
        "note": "Answer from this guide, in a few steps; give the part they asked about. "
        "Menu names vary by app version, so say where else to look if it isn't there.",
    }
