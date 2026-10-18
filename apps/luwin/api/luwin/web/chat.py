"""The chat routes of luwin's API, for its web app.

Each route needs a friend or above (`Auth.linked`) and takes JSON only.

- `POST /api/chat` with `{text}`: one turn, streamed as server-sent events
- `POST /api/chat/pick` with `{label, value, year}`: the choice a picker
  offered, sent as the user's next message and streamed the same way
- `POST /api/chat/decide` with `{pending_id, approve}`: a Confirm/Cancel or
  Approve/Deny press, answered as JSON once it has run
- `POST /api/chat/forget`: starts the conversation fresh

A turn's stream is a run of events, each `event: <name>` with a JSON `data`:
`text` for each chunk of the reply, `confirm` for each action waiting on the
user's press, `choices` for a picker, `titles` for the titles a tool found
(each with its logo and links), then `done`; `error` with a reference
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
import json
import logging
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from luwin.agent.loop import ToolTrace
from luwin.agent.tools import Choice
from luwin.chat.service import ChatResponse, ChatService, OnTool
from luwin.notify import AdminPost, Announcement, ApprovalPost, DirectMessage, Notice, Notifier
from luwin.web.auth import Auth, Viewer, require_json

log = logging.getLogger("luwin.web.chat")

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


def event(name: str, data: dict[str, Any]) -> str:
    return f"event: {name}\ndata: {json.dumps(data, default=str)}\n\n"


def notice_body(notice: Notice) -> dict[str, Any]:
    match notice:
        case AdminPost(text=text):
            return {"kind": "admin_post", "text": text}
        case ApprovalPost(text=text, pending_id=pending_id):
            return {"kind": "approval", "text": text, "pending_id": pending_id}
        case Announcement(text=text):
            return {"kind": "announcement", "text": text}
        case DirectMessage(to=to, text=text):
            return {"kind": "direct_message", "text": text, "to": to}


def tool_body(trace: ToolTrace) -> dict[str, Any]:
    return {"name": trace.name, "input": trace.input, "ok": trace.ok, "result": trace.result}


def reply_events(response: ChatResponse) -> list[str]:
    texts = [event("text", {"text": chunk}) for chunk in response.chunks]
    confirms = [
        event("confirm", {"pending_id": p.id, "summary": p.summary, "action": p.action})
        for p in response.confirmations
    ]
    choices = (
        [
            event(
                "choices",
                {
                    "choices": [
                        {
                            "label": c.label,
                            "value": c.value,
                            "year": c.year,
                            "poster_url": c.poster_url,
                            "detail": c.detail,
                            "display": c.display,
                        }
                        for c in response.choices
                    ]
                },
            )
        ]
        if response.choices
        else []
    )
    titles = (
        [
            event(
                "titles",
                {
                    "titles": [
                        {
                            "key": t.key,
                            "title": t.title,
                            "year": t.year,
                            "logo_url": t.logo_url,
                            "links": [{"label": link.label, "url": link.url} for link in t.links],
                        }
                        for t in response.titles
                    ]
                },
            )
        ]
        if response.titles
        else []
    )
    return [*texts, *confirms, *choices, *titles]


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

    async def _deliver(self, notices: Sequence[Notice]) -> list[dict[str, Any]]:
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
            queue.put_nowait(event("tool", tool_body(trace)))

        async def turn() -> None:
            try:
                response = await run(on_tool if self.trace else None)
                notices = [event("notice", n) for n in await self._deliver(response.notices)]
                failures = (
                    [event("failure", {"detail": response.failure})]
                    if self.trace and response.failure
                    else []
                )
                for item in [*notices, *failures, *reply_events(response)]:
                    queue.put_nowait(item)
                queue.put_nowait(event("done", {}))
            except Exception:
                ref = secrets.token_hex(3)
                log.exception("a chat turn broke outside the agent (ref %s)", ref)
                queue.put_nowait(event("error", {"ref": ref}))
            finally:
                queue.put_nowait(None)

        task = asyncio.create_task(turn())
        self._running.add(task)
        task.add_done_callback(self._running.discard)
        while (item := await queue.get()) is not None:
            yield item

    def router(self) -> APIRouter:
        router = APIRouter(prefix="/api/chat", dependencies=[Depends(require_json)])
        auth = self.auth
        Linked = Annotated[Viewer, Depends(auth.linked)]

        @router.post("")
        async def send(message: Message, viewer: Linked) -> StreamingResponse:
            user = viewer.chat_user
            return StreamingResponse(
                self._stream(
                    lambda on_tool: self.chat.handle_message(user, message.text, on_tool=on_tool)
                ),
                media_type=EVENT_STREAM,
            )

        @router.post("/pick")
        async def pick(chosen: Pick, viewer: Linked) -> StreamingResponse:
            user = viewer.chat_user
            choice = Choice(label=chosen.label, value=chosen.value, year=chosen.year)
            return StreamingResponse(
                self._stream(lambda on_tool: self.chat.pick(user, choice, on_tool=on_tool)),
                media_type=EVENT_STREAM,
            )

        @router.post("/decide")
        async def decide(press: Press, viewer: Linked) -> dict[str, Any]:
            decision = await self.chat.decide(press.pending_id, viewer.chat_user, press.approve)
            return {
                "text": decision.text,
                "settled": decision.settled,
                "notices": await self._deliver(decision.notices),
            }

        @router.post("/forget")
        async def forget(viewer: Linked) -> dict[str, str]:
            return {"text": self.chat.forget(viewer.chat_user)}

        return router
