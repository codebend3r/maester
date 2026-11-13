"""The chat routes of sparrow's API, for its web app.

Each route needs a friend or above (`Auth.linked`) and takes JSON only.

- `POST /api/chat` with `{text}`: one turn, streamed as server-sent events
- `POST /api/chat/pick` with `{label, value, year}`: the choice a picker
  offered, sent as the user's next message and streamed the same way
- `POST /api/chat/decide` with `{pending_id, approve}`: a Confirm or Cancel
  press, answered as JSON once it has run
- `POST /api/chat/forget`: starts the conversation fresh

A turn's stream is a run of events, each `event: <name>` with a JSON `data`:
`text` for each chunk of the reply, `confirm` for each action waiting on the
user's press, `choices` for a picker, `titles` for the titles a tool found
(each with its links), then `done`; `error` with a reference
replaces them when the turn broke outside the agent. With `trace` on (the
sandbox), `tool` reports each tool call as it finishes, `notice` each
notice the turn sent, and `failure` why a turn broke (the exception behind
the reply's error reference), so whoever is testing sees what the reply rests on.

A turn keeps running when the browser goes away mid-stream: its tools may
already have acted, and what they did must still be remembered and delivered.
"""

# No `from __future__ import annotations`: FastAPI reads each route's
# `Annotated[..., Depends(auth...)]` at definition, where `auth` is in scope.
import asyncio
import enum
import logging
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from typing import Annotated, Any, assert_never

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from sparrow.agent.loop import OnTool, ToolTrace
from sparrow.agent.tools import Choice, Title
from sparrow.chat.service import ChatResponse, ChatService
from sparrow.notify import AdminPost, DirectMessage, Notice, Notifier
from sparrow.web.auth import Auth, Viewer, require_json

log = logging.getLogger("sparrow.web.chat")

EVENT_STREAM = "text/event-stream"


class Message(BaseModel):
    text: str


class Pick(BaseModel):
    label: str
    value: str
    year: int | None = None


class Press(BaseModel):
    pending_id: int
    approve: bool


class ChatEvent(enum.StrEnum):
    """The names of a turn's server-sent events."""

    TEXT = "text"
    CONFIRM = "confirm"
    CHOICES = "choices"
    TITLES = "titles"
    TOOL = "tool"
    NOTICE = "notice"
    FAILURE = "failure"
    DONE = "done"
    ERROR = "error"


class NoticeKind(enum.StrEnum):
    ADMIN_POST = "admin_post"
    DIRECT_MESSAGE = "direct_message"


class NoticeBody(BaseModel):
    kind: NoticeKind
    text: str
    to: str | None = None


class ToolBody(BaseModel):
    name: str
    input: dict[str, Any]
    ok: bool
    result: str


class TextBody(BaseModel):
    text: str


class ConfirmBody(BaseModel):
    pending_id: int
    summary: str
    action: str


class ChoiceBody(BaseModel):
    label: str
    value: str
    year: int | None
    detail: str
    display: str


class ChoicesBody(BaseModel):
    choices: list[ChoiceBody]


class LinkBody(BaseModel):
    label: str
    url: str


class TitleBody(BaseModel):
    key: str
    title: str
    year: int | None
    links: list[LinkBody]


class TitlesBody(BaseModel):
    titles: list[TitleBody]


class FailureBody(BaseModel):
    detail: str


class ErrorBody(BaseModel):
    ref: str


class Empty(BaseModel):
    pass


class DecisionBody(BaseModel):
    text: str
    settled: bool
    notices: list[NoticeBody]


class UsageBody(BaseModel):
    model: str
    tokens_used: int | None
    token_budget: int | None


class ForgetBody(BaseModel):
    text: str


def event(name: ChatEvent, data: BaseModel) -> str:
    return f"event: {name}\ndata: {data.model_dump_json()}\n\n"


def notice_body(notice: Notice) -> NoticeBody:
    match notice:
        case AdminPost(text=text):
            return NoticeBody(kind=NoticeKind.ADMIN_POST, text=text)
        case DirectMessage(to=to, text=text):
            return NoticeBody(kind=NoticeKind.DIRECT_MESSAGE, text=text, to=to)
        case _:
            assert_never(notice)


def tool_body(trace: ToolTrace) -> ToolBody:
    return ToolBody(name=trace.name, input=trace.input, ok=trace.ok, result=trace.result)


def choice_body(choice: Choice) -> ChoiceBody:
    return ChoiceBody(
        label=choice.label,
        value=choice.value,
        year=choice.year,
        detail=choice.detail,
        display=choice.display,
    )


def title_body(title: Title) -> TitleBody:
    return TitleBody(
        key=title.key,
        title=title.title,
        year=title.year,
        links=[LinkBody(label=link.label, url=link.url) for link in title.links],
    )


def reply_events(response: ChatResponse) -> list[str]:
    texts = [event(ChatEvent.TEXT, TextBody(text=chunk)) for chunk in response.chunks]
    confirms = [
        event(ChatEvent.CONFIRM, ConfirmBody(pending_id=p.id, summary=p.summary, action=p.action))
        for p in response.confirmations
    ]
    choices = [
        event(ChatEvent.CHOICES, ChoicesBody(choices=[choice_body(c) for c in response.choices]))
    ]
    titles = [event(ChatEvent.TITLES, TitlesBody(titles=[title_body(t) for t in response.titles]))]
    return [
        *texts,
        *confirms,
        *(choices if response.choices else []),
        *(titles if response.titles else []),
    ]


class ChatApi:
    """The chat routes over one `ChatService`.

    The routes read `self.chat` on every request rather than holding the
    service, so the sandbox can open another world under a running app.
    """

    def __init__(self, auth: Auth, chat: ChatService, notifier: Notifier, *, trace: bool = False):
        self.auth = auth
        self.chat = chat
        self.notifier = notifier
        self.trace = trace
        # Turns still running after their stream closed, held so none is collected mid-run.
        self._running: set[asyncio.Task[None]] = set()

    async def _deliver(self, notices: Sequence[Notice]) -> list[NoticeBody]:
        """Hands `notices` to the notifier; returns them as JSON when the trace is on."""
        undelivered = await self.notifier.deliver(notices)
        if undelivered:
            log.warning("%d notices could not be delivered", len(undelivered))
        return [notice_body(n) for n in notices] if self.trace else []

    async def _stream(
        self, run: Callable[[OnTool | None], Awaitable[ChatResponse]]
    ) -> AsyncIterator[str]:
        queue: asyncio.Queue[str | None] = asyncio.Queue()

        def on_tool(trace: ToolTrace) -> None:
            queue.put_nowait(event(ChatEvent.TOOL, tool_body(trace)))

        async def turn() -> None:
            try:
                response = await run(on_tool if self.trace else None)
                notices = [
                    event(ChatEvent.NOTICE, n) for n in await self._deliver(response.notices)
                ]
                failures = (
                    [event(ChatEvent.FAILURE, FailureBody(detail=response.failure))]
                    if self.trace and response.failure
                    else []
                )
                for item in [*notices, *failures, *reply_events(response)]:
                    queue.put_nowait(item)
                queue.put_nowait(event(ChatEvent.DONE, Empty()))
            except Exception:
                ref = secrets.token_hex(3)
                log.exception("a chat turn broke outside the agent (ref %s)", ref)
                queue.put_nowait(event(ChatEvent.ERROR, ErrorBody(ref=ref)))
            finally:
                queue.put_nowait(None)

        task = asyncio.create_task(turn())
        self._running.add(task)
        task.add_done_callback(self._running.discard)
        while (item := await queue.get()) is not None:
            yield item

    def router(self) -> APIRouter:
        router = APIRouter(prefix="/api/chat")
        auth = self.auth
        Linked = Annotated[Viewer, Depends(auth.linked)]

        @router.post("", dependencies=[Depends(require_json)])
        async def send(message: Message, viewer: Linked) -> StreamingResponse:
            user = viewer.chat_user
            return StreamingResponse(
                self._stream(
                    lambda on_tool: self.chat.handle_message(user, message.text, on_tool=on_tool)
                ),
                media_type=EVENT_STREAM,
            )

        @router.post("/pick", dependencies=[Depends(require_json)])
        async def pick(chosen: Pick, viewer: Linked) -> StreamingResponse:
            user = viewer.chat_user
            choice = Choice(label=chosen.label, value=chosen.value, year=chosen.year)
            return StreamingResponse(
                self._stream(lambda on_tool: self.chat.pick(user, choice, on_tool=on_tool)),
                media_type=EVENT_STREAM,
            )

        @router.post("/decide", dependencies=[Depends(require_json)])
        async def decide(press: Press, viewer: Linked) -> DecisionBody:
            decision = await self.chat.decide(press.pending_id, viewer.chat_user, press.approve)
            return DecisionBody(
                text=decision.text,
                settled=decision.settled,
                notices=await self._deliver(decision.notices),
            )

        @router.post("/forget", dependencies=[Depends(require_json)])
        async def forget(viewer: Linked) -> ForgetBody:
            return ForgetBody(text=self.chat.forget(viewer.chat_user))

        @router.get("/usage")
        async def usage(viewer: Linked) -> UsageBody:
            """The model, and today's tokens against the daily budget, for the page's footer."""
            used = self.chat.usage(viewer.chat_user.id)
            return UsageBody(
                model=used.model, tokens_used=used.tokens_used, token_budget=used.token_budget
            )

        return router
