"""A model client that runs each call through headless Claude Code, for local testing.

The sandbox uses it so trying luwin on a laptop rides on the developer's
Claude Code sign-in instead of an API key; only the deployed server talks to
the API (`anthropic.AsyncAnthropic`). It stands in for the SDK client the
agent loop expects: `messages.stream(**params)` opens a context whose events
are the reply's text and whose `get_final_message()` is an SDK `Message`.

Claude Code runs with no built-in tools, no settings, no saved session and in
an empty directory, so nothing of the developer's own setup reaches luwin's
prompt, and without the API credential variables, so it never falls back to a
key. luwin's tools reach it as real tools through a small MCP server that only
lists them (`luwin/agent/claude_code_tools.py`), so the model calls them
natively; the conversation so far comes as JSON. Each call is read off Claude
Code's event stream (`stream-json`) the moment the model makes it, and Claude
Code is stopped before the call runs: the calls go back to the loop as
`tool_use` blocks, the loop runs them under luwin's tiers and confirmations,
and the next call carries their results, as against the API. A reply with no
calls is the run's result.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import sys
import tempfile
import uuid
from asyncio.subprocess import PIPE
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from anthropic.types import Message, TextBlock, ToolUseBlock, Usage

from luwin.agent.claude_code_tools import SERVER

BINARY = "claude"
TIMEOUT_SECONDS = 300.0
# One stream-json event is one line, and a reply's can be long: well past asyncio's 64 KiB.
LINE_LIMIT = 16 * 1024 * 1024
# The variables Claude Code would use instead of the developer's sign-in.
CREDENTIAL_VARIABLES = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")
# What the loop reads off a reply, as the API names it.
END_TURN = "end_turn"
TOOL_USE = "tool_use"
TRANSCRIPT_BLOCKS = ("text", "tool_use", "tool_result")
# The events of Claude Code's `stream-json` this reads.
ASSISTANT = "assistant"
RESULT = "result"
# How Claude Code names a tool from an MCP server.
TOOL_PREFIX = f"mcp__{SERVER}__"

PROTOCOL = """

# How this conversation reaches you

Each message holds the conversation so far as JSON, oldest first, with your earlier tool calls \
and their results. Carry it on as luwin: call your tools as you need them, as many at once as \
make sense, or answer the user."""


class ClaudeCodeFailed(RuntimeError):
    """Claude Code exited with an error, or ended without a reply or a tool call."""


@dataclass(frozen=True)
class TextEvent:
    type: str
    text: str


def _system_text(system: Any) -> str:
    if isinstance(system, str):
        return system
    return "\n\n".join(block.get("text", "") for block in system or [])


def _transcript(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The conversation with only what the model reads: text, tool calls and their results."""
    return [
        {
            "role": message["role"],
            "content": message["content"]
            if isinstance(message["content"], str)
            else [b for b in message["content"] if b.get("type") in TRANSCRIPT_BLOCKS],
        }
        for message in messages
    ]


def render(params: dict[str, Any]) -> str:
    """The prompt for one call: the conversation so far."""
    return json.dumps(_transcript(params["messages"]), indent=1, default=str)


def _usage(raw: dict[str, Any] | None) -> Usage:
    raw = raw or {}
    return Usage(
        input_tokens=int(raw.get("input_tokens", 0)),
        output_tokens=int(raw.get("output_tokens", 0)),
        cache_read_input_tokens=int(raw.get("cache_read_input_tokens", 0)),
    )


def _message(content: list[Any], stop_reason: str, model: str, usage: Usage) -> Message:
    return Message(
        id=f"msg_cc_{uuid.uuid4().hex[:12]}",
        type="message",
        role="assistant",
        model=model,
        content=content,
        stop_reason=stop_reason,
        stop_sequence=None,
        usage=usage,
    )


def luwin_tool(name: Any) -> str | None:
    """The luwin tool a Claude Code tool name calls, or None for any other tool."""
    if isinstance(name, str) and name.startswith(TOOL_PREFIX):
        return name.removeprefix(TOOL_PREFIX)
    return None


def tool_step(event: dict[str, Any], model: str) -> Message | None:
    """An assistant event's calls to luwin's tools, with the text before them, as the step
    the loop runs; None when it calls none of them."""
    message = event.get("message") or {}
    blocks = message.get("content") or []
    calls = [
        (name, b["input"])
        for b in blocks
        if b.get("type") == TOOL_USE
        and (name := luwin_tool(b.get("name")))
        and isinstance(b.get("input"), dict)
    ]
    if not calls:
        return None
    text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
    content: list[Any] = [TextBlock(type="text", text=text)] if text else []
    content += [
        ToolUseBlock(type="tool_use", id=f"toolu_cc_{uuid.uuid4().hex[:12]}", name=name, input=args)
        for name, args in calls
    ]
    return _message(content, TOOL_USE, model, _usage(message.get("usage")))


def reply_step(result: dict[str, Any], model: str) -> Message:
    """The run's result event as the reply that ends the turn."""
    if result.get("is_error") or result.get("subtype") != "success":
        raise ClaudeCodeFailed(f"Claude Code failed: {str(result.get('result') or result)[:500]}")
    text = str(result.get("result") or "").strip()
    content: list[Any] = [TextBlock(type="text", text=text)] if text else []
    return _message(content, END_TURN, model, _usage(result.get("usage")))


class _Stream:
    def __init__(self, model: ClaudeCodeModel, params: dict[str, Any]):
        self._model = model
        self._params = params
        self._message: Message | None = None

    async def __aenter__(self) -> _Stream:
        self._message = await self._model.call(self._params)
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    def __aiter__(self) -> AsyncIterator[TextEvent]:
        async def events() -> AsyncIterator[TextEvent]:
            for block in self._message.content if self._message else []:
                if block.type == "text":
                    yield TextEvent("text", block.text)

        return events()

    async def get_final_message(self) -> Message:
        if self._message is None:
            raise ClaudeCodeFailed("the stream was read before it was opened")
        return self._message


@dataclass
class _Messages:
    model: ClaudeCodeModel

    def stream(self, **params: Any) -> _Stream:
        return _Stream(self.model, params)


class ClaudeCodeModel:
    """`anthropic.AsyncAnthropic`'s `messages.stream`, answered by `claude -p`."""

    def __init__(self, *, binary: str = BINARY, timeout: float = TIMEOUT_SECONDS):
        self.binary = binary
        self.timeout = timeout
        # Empty, so Claude Code finds no CLAUDE.md or project settings to load.
        self.workdir = tempfile.mkdtemp(prefix="luwin-claude-code-")
        self.messages = _Messages(self)

    def tool_server(self, params: dict[str, Any]) -> str:
        """The `--mcp-config` listing this call's tools, kept in a file named by its content."""
        definitions = json.dumps(params.get("tools", []), sort_keys=True)
        digest = hashlib.sha256(definitions.encode()).hexdigest()[:16]
        path = Path(self.workdir) / f"tools-{digest}.json"
        if not path.exists():
            path.write_text(definitions)
        server = {
            "command": sys.executable,
            "args": ["-m", "luwin.agent.claude_code_tools", str(path)],
        }
        return json.dumps({"mcpServers": {SERVER: server}})

    def command(self, params: dict[str, Any]) -> list[str]:
        command = [
            self.binary,
            "--print",
            "--output-format",
            "stream-json",
            "--verbose",
            "--model",
            params["model"],
            "--system-prompt",
            _system_text(params.get("system")) + PROTOCOL,
            "--tools",
            "",
            "--mcp-config",
            self.tool_server(params),
            "--strict-mcp-config",
            "--setting-sources",
            "",
            "--no-session-persistence",
        ]
        effort = (params.get("output_config") or {}).get("effort")
        return [*command, "--effort", effort] if effort else command

    async def call(self, params: dict[str, Any]) -> Message:
        env = {k: v for k, v in os.environ.items() if k not in CREDENTIAL_VARIABLES}
        process = await asyncio.create_subprocess_exec(
            *self.command(params),
            stdin=PIPE,
            stdout=PIPE,
            stderr=PIPE,
            cwd=self.workdir,
            env=env,
            limit=LINE_LIMIT,
        )
        try:
            return await asyncio.wait_for(self._read(process, params), self.timeout)
        except TimeoutError:
            raise ClaudeCodeFailed(f"Claude Code took longer than {self.timeout:.0f}s") from None
        finally:
            # Stopped at the first call: luwin runs it, not Claude Code.
            if process.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    process.kill()
                await process.wait()

    async def _read(self, process: asyncio.subprocess.Process, params: dict[str, Any]) -> Message:
        if process.stdin is None or process.stdout is None:
            raise ClaudeCodeFailed("Claude Code started without its pipes")
        process.stdin.write(render(params).encode())
        await process.stdin.drain()
        process.stdin.close()
        async for line in process.stdout:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("type") == ASSISTANT and (step := tool_step(event, params["model"])):
                return step
            if event.get("type") == RESULT:
                return reply_step(event, params["model"])
        await process.wait()
        stderr = (await process.stderr.read()).decode(errors="replace") if process.stderr else ""
        raise ClaudeCodeFailed(
            f"Claude Code exited {process.returncode} without a reply: {stderr.strip()[-500:]}"
        )
