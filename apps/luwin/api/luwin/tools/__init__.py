"""The tools the model can call, grouped by area.

Importing this package registers every tool module into the process-wide
registry; `app.build()` does that import. Each module decorates plain
async functions with `@tool(...)` from `luwin.agent.tools`.
"""

from luwin.tools import (  # noqa: F401
    access,
    availability,
    collections,
    downloads,
    gaps,
    guides,
    invites,
    lag,
    playback,
    replace,
    requests,
    search,
    service_health,
    status,
    versions,
)
