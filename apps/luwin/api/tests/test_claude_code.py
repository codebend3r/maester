import json
import stat

import pytest

from luwin.agent.claude_code import ClaudeCodeFailed, ClaudeCodeModel, render, reply_step, tool_step
from luwin.agent.claude_code_tools import NOT_HERE, answer
from luwin.agent.loop import Agent
from luwin.agent.runner import ToolRunner
from luwin.agent.tools import Tier, ToolRegistry
from luwin.config import Settings
from luwin.store import Store

TOOLS = [{"name": "search_media", "description": "search", "input_schema": {"type": "object"}}]
PARAMS = {
    "model": "claude-haiku-5-5",
    "system": [{"type": "text", "text": "You are luwin.", "cache_control": {"type": "ephemeral"}}],
    "messages": [
        {"role": "user", "content": "is Dune here?"},
        {
            "role": "assistant",
            "content": [
                {"type": "thinking", "thinking": "", "signature": "x"},
                {
                    "type": "tool_use",
                    "id": "t1",
                    "name": "search_media",
                    "input": {"query": "Dune"},
                },
            ],
        },
        {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "[]"}],
        },
    ],
    "tools": TOOLS,
    "output_config": {"effort": "medium"},
}
USAGE = {"input_tokens": 7, "output_tokens": 3, "cache_read_input_tokens": 100}


def assistant(*blocks):
    return {"type": "assistant", "message": {"content": list(blocks), "usage": USAGE}}


def call(name, args):
    return {"type": "tool_use", "id": "toolu_x", "name": f"mcp__luwin__{name}", "input": args}


def result(text, **extra):
    return {
        "type": "result",
        "subtype": "success",
        "is_error": False,
        "result": text,
        "usage": USAGE,
        **extra,
    }


def fake_claude(tmp_path, *events, code=0):
    """A stand-in `claude` that records its arguments and stdin, then prints `events`, one
    JSON line each, and waits so a reader that stops early has to kill it."""
    (tmp_path / "events").write_text("".join(json.dumps(e) + "\n" for e in events))
    script = tmp_path / "claude"
    script.write_text(
        "#!/bin/sh\n"
        f'printf "%s\\n" "$@" > "{tmp_path}/argv"\n'
        f'cat > "{tmp_path}/stdin"\n'
        f'cat "{tmp_path}/events"\n'
        f"exit {code}\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return str(script)


def test_the_prompt_is_the_conversation_with_only_what_the_model_reads():
    prompt = render(PARAMS)
    assert '"is Dune here?"' in prompt and '"tool_result"' in prompt
    assert '"thinking"' not in prompt


def test_a_call_to_a_luwin_tool_is_the_step_the_loop_runs():
    event = assistant(
        {"type": "text", "text": "Let me look."},
        call("search_media", {"query": "Dune"}),
        {"type": "tool_use", "id": "x", "name": "Bash", "input": {"command": "ls"}},
    )
    step = tool_step(event, "claude-haiku-5-5")
    assert step.stop_reason == "tool_use"
    text, used = step.content
    assert text.text == "Let me look." and used.name == "search_media"
    assert used.input == {"query": "Dune"} and used.id.startswith("toolu_cc_")
    assert step.usage.input_tokens == 7 and step.usage.cache_read_input_tokens == 100
    assert tool_step(assistant({"type": "text", "text": "Hi."}), "claude-haiku-5-5") is None


def test_the_result_is_the_reply_that_ends_the_turn():
    done = reply_step(result("It's not here."), "claude-haiku-5-5")
    assert done.stop_reason == "end_turn" and done.content[0].text == "It's not here."
    with pytest.raises(ClaudeCodeFailed, match="Not logged in"):
        reply_step(result("Not logged in", is_error=True), "claude-haiku-5-5")


def test_the_tool_server_lists_the_tools_and_runs_none():
    init = answer(
        {"id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}, TOOLS
    )
    assert init["result"]["capabilities"] == {"tools": {}}
    listed = answer({"id": 2, "method": "tools/list"}, TOOLS)["result"]["tools"]
    assert listed == [
        {"name": "search_media", "description": "search", "inputSchema": {"type": "object"}}
    ]
    called = answer({"id": 3, "method": "tools/call", "params": {"name": "search_media"}}, TOOLS)
    assert called["result"] == {"content": [{"type": "text", "text": NOT_HERE}], "isError": True}
    assert answer({"id": 4, "method": "resources/list"}, TOOLS)["error"]["code"] == -32601


async def test_it_runs_claude_code_on_the_sign_in_never_a_key(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-reach-claude-code")
    model = ClaudeCodeModel(binary=fake_claude(tmp_path, {"type": "system"}, result("Hi.")))
    async with model.messages.stream(**PARAMS) as stream:
        events = [event.text async for event in stream]
        message = await stream.get_final_message()
    assert events == ["Hi."] and message.content[0].text == "Hi."

    argv = (tmp_path / "argv").read_text().splitlines()
    assert argv[:5] == ["--print", "--output-format", "stream-json", "--verbose", "--model"]
    assert argv[5] == "claude-haiku-5-5" and argv[-2:] == ["--effort", "medium"]
    assert argv[argv.index("--system-prompt") + 1].startswith("You are luwin.")
    assert argv[argv.index("--tools") + 1] == "" and "--no-session-persistence" in argv
    server = json.loads(argv[argv.index("--mcp-config") + 1])["mcpServers"]["luwin"]
    assert server["args"][:2] == ["-m", "luwin.agent.claude_code_tools"]
    assert json.loads(open(server["args"][2]).read()) == TOOLS
    assert "is Dune here?" in (tmp_path / "stdin").read_text()


async def test_it_stops_at_the_first_tool_call(tmp_path):
    model = ClaudeCodeModel(
        binary=fake_claude(
            tmp_path,
            assistant(call("search_media", {"query": "Dune"})),
            result("should never be read"),
        )
    )
    message = await model.call(PARAMS)
    assert [b.name for b in message.content] == ["search_media"]


async def test_a_failed_run_says_why(tmp_path):
    errored = ClaudeCodeModel(binary=fake_claude(tmp_path, result("Not logged in", is_error=True)))
    with pytest.raises(ClaudeCodeFailed, match="Not logged in"):
        await errored.call(PARAMS)
    silent = ClaudeCodeModel(binary=fake_claude(tmp_path, code=2))
    with pytest.raises(ClaudeCodeFailed, match="exited 2 without a reply"):
        await silent.call(PARAMS)


async def test_the_agent_loop_runs_tools_through_it(tmp_path):
    reg = ToolRegistry()

    @reg.tool("search_media", "search")
    async def search(ctx, query: str):
        return [{"title": "Dune", "year": 2021}]

    # The stand-in calls the search first, then answers once the result is in the conversation.
    first = json.dumps(assistant(call("search_media", {"query": "Dune"})))
    then = json.dumps(result("Dune (2021) is there."))
    script = tmp_path / "claude"
    script.write_text(
        "#!/bin/sh\n"
        "if grep -q tool_result; then\n"
        f"  printf '%s\\n' '{then}'\n"
        "else\n"
        f"  printf '%s\\n' '{first}'\n"
        "fi\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    store = Store(":memory:")
    agent = Agent(
        model_client=ClaudeCodeModel(binary=str(script)),
        model="claude-haiku-5-5",
        runner=ToolRunner(reg),
        store=store,
        services=None,
        settings=Settings(),
    )
    reply = await agent.respond("u1", Tier.FRIEND, "is Dune here?")
    assert reply.text == "Dune (2021) is there."
    assert reply.tool_calls == [{"name": "search_media", "input": {"query": "Dune"}, "ok": True}]
    store.close()
