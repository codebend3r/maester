"""How durations and sizes read to people, shared by every tool that says them."""

from __future__ import annotations


def humanized(seconds: int) -> str:
    """ "about 12 min", "about 2 h 5 min", "about 1 d 3 h"."""
    minutes = max(1, round(seconds / 60))
    if minutes < 60:
        return f"about {minutes} min"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"about {hours} h {minutes} min" if minutes else f"about {hours} h"
    days, hours = divmod(hours, 24)
    return f"about {days} d {hours} h" if hours else f"about {days} d"


def gigabytes(size: int) -> str:
    return f"{size / 1e9:.1f} GB"
