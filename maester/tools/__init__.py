"""The tools the model can call, grouped by area.

Importing this package registers every tool module into the process-wide
registry; `app.build()` does that import. Each module decorates plain
async functions with `@tool(...)` from `maester.agent.tools`.
"""

from maester.tools import (  # noqa: F401
    accounts,
    availability,
    collections,
    gaps,
    lag,
    playback,
    replace,
    requests,
    search,
    status,
)
