"""Performance: why a stream lags, and what the friend can do about it.

- `load.py`    how busy each Plex host is (Tautulli, plus CPU and memory from the fleet
               monitor), and whether that could be the cause
- `uplink.py`  the on-demand speed test, rationed, against the remote streams it carries

A stream's own facts are the playback package's `Playback` (`maester/playback/plays.py`).
"""
