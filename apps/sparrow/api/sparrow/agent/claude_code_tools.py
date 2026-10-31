"""The MCP server that hands sparrow's tools to headless Claude Code, so the model calls them natively.

`ClaudeCodeModel` starts Claude Code with this as its one MCP server (`--mcp-config`), over
stdio, with a JSON file of the tool definitions the turn offers. It only lists them: the model's
call is read off Claude Code's event stream and the run is stopped before the call gets here,
and sparrow's own loop runs it. One that arrives anyway is answered with an error.

`python -m sparrow.agent.claude_code_tools <definitions.json>`
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

SERVER = "sparrow"
PROTOCOL_VERSION = "2025-06-18"
NOT_HERE = "sparrow runs its tools itself; this call never reaches them."


def answer(message: dict[str, Any], tools: list[dict[str, Any]]) -> dict[str, Any]:
    """The JSON-RPC reply to one request."""
    method = message.get("method")
    reply: dict[str, Any] = {"jsonrpc": "2.0", "id": message["id"]}
    if method == "initialize":
        asked = (message.get("params") or {}).get("protocolVersion") or PROTOCOL_VERSION
        reply["result"] = {
            "protocolVersion": asked,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER, "version": "1"},
        }
    elif method == "tools/list":
        reply["result"] = {
            "tools": [
                {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "inputSchema": t["input_schema"],
                }
                for t in tools
            ]
        }
    elif method == "tools/call":
        reply["result"] = {"content": [{"type": "text", "text": NOT_HERE}], "isError": True}
    elif method == "ping":
        reply["result"] = {}
    else:
        reply["error"] = {"code": -32601, "message": f"no method {method}"}
    return reply


def main(argv: list[str] | None = None) -> int:
    (definitions,) = sys.argv[1:] if argv is None else argv
    tools = json.loads(Path(definitions).read_text())
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except ValueError:
            continue
        if "id" in message and "method" in message:  # notifications need no reply
            print(json.dumps(answer(message, tools)), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
