"""sparrow: the AI concierge of the maester suite, for its friends and its admin."""

from importlib.metadata import PackageNotFoundError, version

# The release version lives in pyproject.toml (written by the bump script), so
# read it from the installed package rather than keeping a second copy here.
try:
    __version__ = version("sparrow")
except PackageNotFoundError:  # running from a source tree that was never installed
    __version__ = "0.0.0"
