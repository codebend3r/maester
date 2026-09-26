"""A scripted stand-in for `anthropic.AsyncAnthropic` for tests and evals.

Each call to `messages.stream()` pops the next scripted response. Responses
are real SDK `Message` objects, so the loop exercises the same `.to_dict()`
and `.type` paths it uses in production.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from anthropic.types import Message, TextBlock, ToolUseBlock, Usage


def text_message(text: str, stop_reason: str = "end_turn") -> Message:
    return Message(
        id="msg_fake",
        type="message",
        role="assistant",
        model="fake",
        content=[TextBlock(type="text", text=text)],
        stop_reason=stop_reason,  # type: ignore[arg-type]
        stop_sequence=None,
        usage=Usage(input_tokens=10, output_tokens=len(text) // 4 + 1),
    )


def tool_message(
    calls: list[tuple[str, dict[str, Any]]], text: str = "", stop_reason: str = "tool_use"
) -> Message:
    content: list[Any] = [TextBlock(type="text", text=text)] if text else []
    content += [
        ToolUseBlock(type="tool_use", id=f"toolu_{i}", name=name, input=args)
        for i, (name, args) in enumerate(calls)
    ]
    return Message(
        id="msg_fake",
        type="message",
        role="assistant",
        model="fake",
        content=content,
        stop_reason=stop_reason,  # type: ignore[arg-type]
        stop_sequence=None,
        usage=Usage(input_tokens=10, output_tokens=5),
    )


@dataclass
class _TextEvent:
    type: str
    text: str


class _FakeStream:
    def __init__(self, message: Message):
        self._message = message

    async def __aenter__(self) -> _FakeStream:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    def __aiter__(self):
        async def events():
            for block in self._message.content:
                if block.type == "text":
                    yield _TextEvent("text", block.text)

        return events()

    async def get_final_message(self) -> Message:
        return self._message


@dataclass
class FakeMessages:
    script: list[Message]
    calls: list[dict[str, Any]] = field(default_factory=list)

    def stream(self, **params: Any) -> _FakeStream:
        self.calls.append(params)
        if not self.script:
            raise AssertionError("fake model has no scripted response left")
        return _FakeStream(self.script.pop(0))


@dataclass
class FakeModel:
    messages: FakeMessages

    @classmethod
    def scripted(cls, *responses: Message) -> FakeModel:
        return cls(FakeMessages(list(responses)))
