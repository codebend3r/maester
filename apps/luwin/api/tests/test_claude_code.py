import json
import stat

import pytest

from luwin.agent.claude_code import ClaudeCodeFailed, ClaudeCodeModel, render, to_message
from luwin.agent.loop import Agent
from luwin.agent.runner import ToolRunner
from luwin.agent.tools import Tier, ToolRegistry
from luwin.config import Settings
from luwin.store import Store

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
    "tools": [
        {"name": "search_media", "description": "search", "input_schema": {"type": "object"}}
    ],
    "output_config": {"effort": "medium"},
}


def fake_claude(tmp_path, answer, code=0):
    """A stand-in `claude` that records its arguments and stdin, then prints `answer`."""
    script = tmp_path / "claude"
    script.write_text(
        "#!/bin/sh\n"
        f'printf "%s\\n" "$@" > "{tmp_path}/argv"\n'
        f'cat > "{tmp_path}/stdin"\n'
        f"printf '%s' '{answer}'\n"
        f"exit {code}\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return str(script)


def step(text="", calls=(), **extra):
    return json.dumps(
        {
            "type": "result",
            "is_error": False,
            "structured_output": {"text": text, "tool_calls": list(calls)},
            "usage": {"input_tokens": 7, "output_tokens": 3, "cache_read_input_tokens": 100},
            **extra,
        }
    )


def test_the_prompt_shows_the_tools_and_only_what_the_model_reads():
    prompt = render(PARAMS)
    assert '"name": "search_media"' in prompt and '"is Dune here?"' in prompt
    assert '"tool_result"' in prompt and '"thinking"' not in prompt


def test_a_step_becomes_the_message_the_loop_reads():
    calls = [{"name": "search_media", "input": {"query": "Dune"}}, {"name": 3, "input": {}}]
    message = to_message(json.loads(step("Let me look.", calls)), "claude-haiku-5-5")
    assert message.stop_reason == "tool_use"
    text, call = message.content
    assert text.text == "Let me look." and call.name == "search_media"
    assert call.input == {"query": "Dune"} and call.id.startswith("toolu_cc_")
    assert message.usage.input_tokens == 7 and message.usage.cache_read_input_tokens == 100

    done = to_message(json.loads(step("It's not here.")), "claude-haiku-5-5")
    assert done.stop_reason == "end_turn" and [b.type for b in done.content] == ["text"]
    with pytest.raises(ClaudeCodeFailed, match="without a step"):
        to_message({"result": "plain text"}, "claude-haiku-5-5")


async def test_it_runs_claude_code_on_the_sign_in_never_a_key(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-reach-claude-code")
    model = ClaudeCodeModel(binary=fake_claude(tmp_path, step("Hi.")))
    async with model.messages.stream(**PARAMS) as stream:
        events = [event.text async for event in stream]
        message = await stream.get_final_message()
    assert events == ["Hi."] and message.content[0].text == "Hi."

    argv = (tmp_path / "argv").read_text().splitlines()
    assert argv[:4] == ["--print", "--output-format", "json", "--model"]
    assert argv[4] == "claude-haiku-5-5" and argv[-2:] == ["--effort", "medium"]
    assert argv[argv.index("--system-prompt") + 1].startswith("You are luwin.")
    assert argv[argv.index("--tools") + 1] == "" and "--no-session-persistence" in argv
    assert "is Dune here?" in (tmp_path / "stdin").read_text()


async def test_a_failed_run_says_why(tmp_path):
    errored = ClaudeCodeModel(
        binary=fake_claude(tmp_path, '{"is_error": true, "result": "Not logged in"}', 1)
    )
    with pytest.raises(ClaudeCodeFailed, match="Not logged in"):
        await errored.call(PARAMS)
    garbled = ClaudeCodeModel(binary=fake_claude(tmp_path, "not json", 2))
    with pytest.raises(ClaudeCodeFailed, match="exited 2"):
        await garbled.call(PARAMS)


async def test_the_agent_loop_runs_tools_through_it(tmp_path):
    reg = ToolRegistry()

    @reg.tool("search_media", "search")
    async def search(ctx, query: str):
        return [{"title": "Dune", "year": 2021}]

    # The stand-in asks for the search first, then answers once it has seen the result.
    script = tmp_path / "claude"
    script.write_text(
        "#!/bin/sh\n"
        "if grep -q tool_result; then\n"
        f"  printf '%s' '{step('Dune (2021) is there.')}'\n"
        "else\n"
        f"  printf '%s' '{step(calls=[{'name': 'search_media', 'input': {'query': 'Dune'}}])}'\n"
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
