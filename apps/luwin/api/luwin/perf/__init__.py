"""Performance: why a stream lags, and what the friend can do about it.

- `load.py`      how busy each Plex host is (Tautulli, plus CPU and memory from the fleet
                 monitor), and whether that could be the cause
- `uplink.py`    the on-demand speed test, rationed, against the remote streams it carries
- `versions.py`  which of a title's versions (`luwin/plex_versions.py`) a connection carries
- `lag.py`       what slows one stream down, as a rules table of findings and fixes
- `reencode.py`  heavy remuxes friends keep streaming away from home, flagged to the admin

A stream's own facts are the playback package's `Playback` (`luwin/playback/plays.py`),
and two of its player limits (`CLIENT_LIMITS`) are lag rules too.
"""
