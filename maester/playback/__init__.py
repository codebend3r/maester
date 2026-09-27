"""Playback problems: which copy a friend means, why it fails, and what to do about it.

- `items.py`          a copy's file on its owning host (the copy itself is `maester/media.py`)
- `plays.py`          a friend's live and recent plays across every Tautulli host
- `client_limits.py`  known player limits as a rules table, each with its fix
- `health.py`         the file health check: a short decode, judged
- `tracks.py`         a file's audio and subtitle tracks, as people read them
- `reports.py`        the report model and its one flow: diagnose, decide, record
- `replace.py`        the replacement's steps: blocklist, delete, search
"""
