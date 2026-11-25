import json

import pytest
from fastapi.testclient import TestClient

from sparrow.agent.tools import Choice, Ok, Title, TitleLink, ToolRegistry, offer
from sparrow.app import build
from sparrow.clients.seerr import SeerrUser
from sparrow.config import load_settings
from sparrow.notify import AdminPost, DirectMessage
from sparrow.web import create_app
from sparrow.web.auth import AccountVerifier, Auth
from sparrow.web.chat import ChatApi
from tests.fake_model import FakeModel, text_message, tool_message
from tests.test_auth import BOSS, DANY, NEWBIE, bearer


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
    """The chat routes over stand-in tools, for Dany (a friend), the owner, and a newcomer
    raven hasn't approved."""
    reg = ToolRegistry()

    @reg.tool("search_media", "search")
    async def search(ctx, query: str = ""):
        return offer([Choice("Dune", "438631", 2021), Choice("Dune", "841", 1984)])

    @reg.tool("find_title", "find a title to show")
    async def find_title(ctx, query: str = ""):
        dune = Title("raven:movie:277", "Dune", 2021, (
            TitleLink("4K Movies 4K", "http://raven.test/movies/277?library=4"),))  # fmt: skip
        return Ok({"found": "Dune"}, titles=(dune,))

    @reg.tool("read_raven", "reads raven as the asker")
    async def read_raven(ctx):
        return {"plays": len(await ctx.raven.history(5))}

    @reg.tool("replace_media", "replace", destructive=True)
    async def replace(ctx, file_id: int = 0):
        return f"replaced file {file_id}"

    @reg.tool("report_problem", "tells the admin and the requester")
    async def report(ctx, tmdb_id: int = 0):
        notices = (AdminPost("Dany reports Dune"), DirectMessage("d1", "noted"))
        return Ok("reported", notices)

    raven = services.raven
    raven.accounts = {"t-boss": BOSS, "t-dany": DANY, "t-new": NEWBIE}
    services.seerr.user_list = [SeerrUser(4, "dany@example.com", "Dany")]
    outbox = Outbox()

    def make(*script, trace=False):
        app = build(
            load_settings({}),
            services=services,
            model_client=FakeModel.scripted(*script),
            tools=reg,
            store=store,
        )
        auth = Auth(AccountVerifier(raven), app.chat.identity)
        api = ChatApi(auth, app.chat, outbox, trace=trace)
        client = TestClient(create_app(chat=api))
        client.headers.update(bearer("t-dany"))
        return client, app

    return make, outbox


def test_a_turn_needs_an_approved_account_and_json(chat):
    make, _ = chat
    client, _ = make()
    assert client.post("/api/chat", content="text=hi").json() == {"reason": "json_only"}
    client.headers.update(bearer("t-new"))
    assert client.post("/api/chat", json={"text": "hi"}).json()["reason"] == "not_approved"
    del client.headers["Authorization"]
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
        tool_message([("report_problem", {"tmdb_id": 438631})]),
        text_message("Reported."),
        trace=True,
    )
    shown = [d for name, d in events(client.post("/api/chat", json={"text": "dune is broken"}))
             if name == "notice"]  # fmt: skip
    assert shown == [
        {"kind": "admin_post", "text": "Dany reports Dune", "to": None},
        {"kind": "direct_message", "text": "noted", "to": "d1"},
    ]
    assert outbox.sent == [AdminPost("Dany reports Dune"), DirectMessage("d1", "noted")]


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
    assert app.store.recent_messages(DANY.id, max_tokens=1000) == []


def test_a_turn_s_tools_read_raven_with_the_asker_s_own_token(chat, services):
    make, _ = chat
    client, _ = make(tool_message([("read_raven", {})]), text_message("You've watched nothing."))
    client.post("/api/chat", json={"text": "what did I watch?"})
    assert services.raven.viewers == ["t-dany"]
