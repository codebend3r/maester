"""Performance: why a stream lags, and what the friend can do about it.

- `load.py`      how busy the servers are (CPU and memory from the fleet monitor, and
                 raven's streams for the admin), and whether that could be the cause
- `uplink.py`    the on-demand speed test, rationed: the upload the streams leave free
- `versions.py`  which of a title's files in raven a connection carries
- `lag.py`       what slows one of the friend's raven streams down, as a rules table
                 of findings and fixes
"""
