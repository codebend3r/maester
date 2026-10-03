"""maester: an AI concierge for a private Plex server."""

from importlib.metadata import PackageNotFoundError, version

# The release version lives in pyproject.toml (written by the bump script), so
# read it from the installed package rather than keeping a second copy here.
try:
    __version__ = version("maester")
except PackageNotFoundError:  # running from a source tree that was never installed
    __version__ = "0.0.0"
