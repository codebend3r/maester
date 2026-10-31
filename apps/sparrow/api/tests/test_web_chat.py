import json

import pytest
from fastapi.testclient import TestClient

from sparrow.agent.tools import (
    Approval,
    Choice,
    Choices,
    NeedsApproval,
    Shown,
    Tier,
    Title,
    TitleLink,
    ToolRegistry,
)
from sparrow.app import build
from sparrow.clients import FakeRookery
from sparrow.clients.seerr import SeerrUser
from sparrow.config import load_settings
from sparrow.web import create_app
from sparrow.web.auth import COOKIE, Auth, SessionVerifier
from sparrow.web.chat import ChatApi
from tests.fake_model import FakeModel, text_message, tool_message
from tests.test_auth import BOSS, DANY, SIGN_IN, STRANGER


class Outbox:
    def __init__(self):
        self.sent = []

    async def deliver(self, notices):
        self.sent.extend(notices)
        return []


def events(response):
    """The stream's events as (name, data) pairs."""
    parsed = []
    for block in response.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        parsed.append((lines["event"], json.loads(lines["data"])))
    return parsed


@pytest.fixture
def chat(services, store):
    """The chat routes over three stand-in tools, for Dany (a friend), the owner, a stranger."""
    reg = ToolRegistry()

    @reg.tool("search_media", "search")
    async def search(ctx, query: str = ""):
        return Choices([Choice("Dune", "438631", 2021), Choice("Dune", "841", 1984)])

    @reg.tool("find_title", "find a title to show")
    async def find_title(ctx, query: str = ""):
        dune = Title("raven:movie:277", "Dune", 2021, "http://raven.test/logo", (
            TitleLink("4K Movies 4K", "http://raven.test/movies/277?library=4"),))  # fmt: skip
        return Shown({"found": "Dune"}, (dune,))

    @reg.tool("replace_media", "replace", destructive=True)
    async def replace(ctx, file_id: int = 0):
        return f"replaced file {file_id}"

    @reg.tool("request_media_4k", "4K")
    async def request_4k(ctx, tmdb_id: int = 0):
        approval = Approval("Dany wants Dune in 4K", "4k 438631", decide_4k, {"tmdb_id": tmdb_id})
        return NeedsApproval("waiting on the admin", approval)

    @reg.tool("decide_4k", "the admin's 4K decision", tier=Tier.ADMIN, button_only=True)
    async def decide_4k(ctx, tmdb_id: int = 0, approved: bool = False):
        return "approved" if approved else "denied"

    rookery = FakeRookery(sessions={"t-boss": BOSS, "t-dany": DANY, "t-x": STRANGER})
    services.seerr.user_list = [SeerrUser(4, "dany@example.com", "Dany", "dany_t")]
    outbox = Outbox()

    def make(*script, trace=False):
        app = build(
            load_settings({}),
            services=services,
            model_client=FakeModel.scripted(*script),
            tools=reg,
            store=store,
            rookery=rookery,
        )
        auth = Auth(SessionVerifier(rookery), app.chat.identity, sign_in=SIGN_IN)
        api = ChatApi(auth, app.chat, outbox, trace=trace)
        client = TestClient(create_app(chat=api))
        client.cookies.set(COOKIE, "t-dany")
        return client, app

    return make, outbox


def test_a_turn_needs_a_linked_session_and_json(chat):
    make, _ = chat
    client, _ = make()
    assert client.post("/api/chat", content="text=hi").json() == {"reason": "json_only"}
    client.cookies.set(COOKIE, "t-x")
    assert client.post("/api/chat", json={"text": "hi"}).json()["reason"] == "unlinked"
    client.cookies.clear()
    assert client.post("/api/chat", json={"text": "hi"}).status_code == 401


def test_a_plain_reply_streams_its_text_then_done(chat):
    make, _ = chat
    client, _ = make(text_message("Hello there."))
    r = client.post("/api/chat", json={"text": "hi"})
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["Cache-Control"] == "no-store"
    assert events(r) == [("text", {"text": "Hello there."}), ("done", {})]


def test_tool_calls_stream_only_with_the_trace_on(chat):
    make, _ = chat
    script = (tool_message([("search_media", {"query": "dune"})]), text_message("Which Dune?"))
    client, _ = make(*script)
    names = [name for name, _ in events(client.post("/api/chat", json={"text": "get dune"}))]
    assert names == ["text", "choices", "done"]

    client, _ = make(*script, trace=True)
    (tool, *rest) = events(client.post("/api/chat", json={"text": "get dune"}))
    assert tool[0] == "tool" and tool[1]["name"] == "search_media" and tool[1]["ok"]
    assert tool[1]["input"] == {"query": "dune"} and "1984" in tool[1]["result"]
    assert [name for name, _ in rest] == ["text", "choices", "done"]
    choices = dict(rest)["choices"]["choices"]
    assert [c["display"] for c in choices] == ["Dune (2021)", "Dune (1984)"]


def test_titles_a_tool_found_are_shown_once_with_the_reply(chat):
    make, _ = chat
    client, _ = make(
        tool_message([("find_title", {"query": "dune"}), ("find_title", {"query": "Dune"})]),
        text_message("Dune is here."),
    )
    found = dict(events(client.post("/api/chat", json={"text": "is Dune here?"})))
    assert found["titles"] == {
        "titles": [
            {
                "key": "raven:movie:277",
                "title": "Dune",
                "year": 2021,
                "logo_url": "http://raven.test/logo",
                "links": [
                    {"label": "4K Movies 4K", "url": "http://raven.test/movies/277?library=4"}
                ],
            }
        ]
    }


def test_a_pick_is_sent_as_the_next_message(chat):
    make, _ = chat
    client, app = make(text_message("Requested."))
    r = client.post("/api/chat/pick", json={"label": "Dune", "value": "438631", "year": 2021})
    assert events(r)[0] == ("text", {"text": "Requested."})
    sent = app.agent.client.messages.calls[0]["messages"][-1]
    assert sent == {"role": "user", "content": "I pick: Dune (2021) (438631)"}


def test_a_confirmation_is_pressed_through_decide(chat):
    make, _ = chat
    client, _ = make(
        tool_message([("replace_media", {"file_id": 7})]), text_message("Confirm below.")
    )
    confirm = dict(events(client.post("/api/chat", json={"text": "replace it"})))["confirm"]
    assert confirm["action"] == "replace_media"
    press = {"pending_id": confirm["pending_id"], "approve": True}
    assert client.post("/api/chat/decide", json=press).json() == {
        "text": "Done: replaced file 7",
        "settled": True,
        "notices": [],
    }
    assert "no longer waiting" in client.post("/api/chat/decide", json=press).json()["text"]


def test_notices_are_delivered_and_shown_with_the_trace(chat):
    make, outbox = chat
    client, _ = make(
        tool_message([("request_media_4k", {"tmdb_id": 438631})]),
        text_message("Asked the admin."),
        trace=True,
    )
    notice = dict(events(client.post("/api/chat", json={"text": "dune in 4k"})))["notice"]
    assert notice["kind"] == "approval" and "4K" in notice["text"]
    assert [n.pending_id for n in outbox.sent] == [notice["pending_id"]]

    press = {"pending_id": notice["pending_id"], "approve": True}
    refused = client.post("/api/chat/decide", json=press).json()
    assert refused["settled"] is False and "admin" in refused["text"]
    client.cookies.set(COOKIE, "t-boss")
    assert client.post("/api/chat/decide", json=press).json()["text"] == "approved"


def test_a_turn_that_breaks_outside_the_agent_streams_an_error(chat, caplog):
    make, _ = chat
    client, app = make()

    async def broken(*args, **kwargs):
        raise RuntimeError("store gone")

    app.chat.handle_message = broken
    ((name, data),) = events(client.post("/api/chat", json={"text": "hi"}))
    assert name == "error" and len(data["ref"]) == 6
    assert data["ref"] in caplog.text


def test_why_a_turn_broke_streams_only_with_the_trace_on(chat):
    make, _ = chat
    client, _ = make()  # nothing scripted: the model call raises
    names = [name for name, _ in events(client.post("/api/chat", json={"text": "hi"}))]
    assert names == ["text", "done"]

    client, _ = make(trace=True)
    (failure, text, _) = events(client.post("/api/chat", json={"text": "hi"}))
    assert failure == (
        "failure",
        {"detail": "AssertionError: fake model has no scripted response left"},
    )
    assert "something went wrong" in text[1]["text"]


def test_forget_starts_the_conversation_fresh(chat):
    make, _ = chat
    client, app = make(text_message("Hi."))
    client.post("/api/chat", json={"text": "hi"})
    assert client.post("/api/chat/forget", json={}).json() == {
        "text": "Forgotten. We're starting fresh."
    }
    assert app.store.recent_messages(DANY.user_id, max_tokens=1000) == []
