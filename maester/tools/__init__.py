"""The tools the model can call, grouped by area.

Importing this package registers every tool module into the process-wide
registry; `app.build()` does that import. Each module decorates plain
async functions with `@tool(...)` from `maester.agent.tools`.
"""

from maester.tools import basics  # noqa: F401
