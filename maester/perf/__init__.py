"""Performance: why a stream lags, and what the friend can do about it.

- `load.py`      how busy each Plex host is (Tautulli, plus CPU and memory from the fleet
                 monitor), and whether that could be the cause
- `uplink.py`    the on-demand speed test, rationed, against the remote streams it carries
- `versions.py`  a title's versions with their bitrates, and which one a connection carries
- `lag.py`       what slows one stream down, as a rules table of findings and fixes

A stream's own facts are the playback package's `Playback` (`maester/playback/plays.py`),
and two of its player limits (`CLIENT_LIMITS`) are lag rules too.
"""
