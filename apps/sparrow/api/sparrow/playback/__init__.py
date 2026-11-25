"""Playback problems: which copy a friend means, why it fails, and what to do about it.

- `items.py`          a copy's file on its owning host (the copy itself is `sparrow/media.py`)
- `plays.py`          a friend's latest plays in raven, as titles and copies Seerr knows
- `health.py`         the file health check: a short decode, judged
- `tracks.py`         a file's audio and subtitle tracks, as people read them
- `diagnosis.py`      each report kind's diagnosis, and what each one found
- `reports.py`        the report model and its one flow: diagnose, decide, record; statuses
- `replace.py`        the replacement's steps: blocklist, delete, search
"""
