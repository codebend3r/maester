"""Device setup guides, as markdown, which the model answers from rather than from memory.

One guide per device, each ending with what every device shares
(`streaming.md`: quality, the relay, Direct Play, subtitles, sound).
"""

from __future__ import annotations

from pathlib import Path

GUIDES_DIR = Path(__file__).resolve().parent

# The devices there's a guide for, by the name tools and commands use.
DEVICES = {
    "apple_tv": "apple-tv",
    "roku": "roku",
    "fire_tv": "fire-tv",
    "android_tv": "android-tv",
    "mobile": "mobile",
    "web": "web",
}


def guide(device: str) -> str:
    """A device's guide, then the settings every device shares."""
    own = (GUIDES_DIR / f"{DEVICES[device]}.md").read_text()
    return f"{own.strip()}\n\n{(GUIDES_DIR / 'streaming.md').read_text().strip()}"
