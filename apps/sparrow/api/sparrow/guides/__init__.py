"""Setup guides for raven's apps, as markdown, which the model answers from rather than
from memory.

One guide per app, each ending with what every app shares (`streaming.md`: the
Quality menu, a connection too slow for the file, audio and subtitles).
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

GUIDES_DIR = Path(__file__).resolve().parent

# The apps there's a guide for, by the name tools use.
Device = Literal["mac", "web"]
# Each app's guide file.
DEVICES: dict[Device, str] = {"mac": "mac", "web": "web"}


def guide(device: Device) -> str:
    """An app's guide, then what every app shares."""
    own = (GUIDES_DIR / f"{DEVICES[device]}.md").read_text()
    return f"{own.strip()}\n\n{(GUIDES_DIR / 'streaming.md').read_text().strip()}"
