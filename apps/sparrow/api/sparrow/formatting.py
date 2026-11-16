"""How durations, sizes and speeds read to people, shared by every tool that says them."""

from __future__ import annotations

from datetime import timedelta


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


def ago(age: timedelta) -> str:
    """ "just now" under a minute, else "about 4 min ago"."""
    if age < timedelta(minutes=1):
        return "just now"
    return f"{humanized(int(age.total_seconds()))} ago"


def gigabytes(size: int) -> str:
    return f"{size / 1e9:.1f} GB"


def mbps(kbps: int) -> float:
    """A bitrate in kbps as Mbps to a tenth; `f"{mbps(k):g}"` reads "2" or "10.2"."""
    return round(kbps / 1000, 1)
