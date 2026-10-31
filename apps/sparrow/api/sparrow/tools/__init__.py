"""The tools the model can call, grouped by area.

Importing this package registers every tool module into the process-wide
registry; `app.build()` does that import. Each module decorates plain
async functions with `@tool(...)` from `sparrow.agent.tools`.
"""

from sparrow.tools import (  # noqa: F401
    access,
    arrs,
    availability,
    collections,
    downloads,
    gaps,
    guides,
    invites,
    lag,
    playback,
    raven,
    replace,
    requests,
    search,
    service_health,
    status,
    versions,
)
