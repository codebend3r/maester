import json
import os

import pytest
from fastapi.testclient import TestClient

from sparrow import sandbox as sandbox_module
from sparrow.agent.claude_code import ClaudeCodeModel
from sparrow.sandbox import BLANK, Sandbox


@pytest.fixture
def client():
    sandbox = Sandbox("fake")
    return TestClient(sandbox.app()), sandbox


def test_it_opens_a_blank_world_as_a_friend_with_no_sign_in(client):
    web, _ = client
    assert web.get("/api/me").json() == {
        "user": {"id": "eval-user", "display_name": "Sandbox friend"},
        "tier": "friend",
    }
    state = web.get("/api/sandbox").json()
    assert state["model"] == "fake" and state["raven"] is None
    assert state["case"] == {"id": BLANK, "name": "Blank world", "turns": []}
    ids = [c["id"] for c in state["cases"]]
    assert ids[0] == BLANK and "simple_request" in ids


def test_a_case_brings_its_tier_and_turns(client):
    web, _ = client
    case = web.post("/api/sandbox/case", json={"case": "trusted_4k_goes_to_admin"}).json()["case"]
    assert case["id"] == "trusted_4k_goes_to_admin" and case["turns"]
    assert set(case["turns"][0]) == {
        "user",
        "expect_tools",
        "forbid_tools",
        "reply_matches",
        "reply_not_matches",
    }
    assert web.get("/api/me").json()["tier"] == "trusted"
    unknown = web.post("/api/sandbox/case", json={"case": "../../etc/passwd"})
    assert unknown.status_code == 404 and unknown.json() == {"reason": "unknown_case"}


def test_the_tier_can_change_mid_conversation(client):
    web, _ = client
    assert web.post("/api/sandbox/tier", json={"tier": "admin"}).json() == {"tier": "admin"}
    assert web.get("/api/me").json()["tier"] == "admin"
    assert web.post("/api/sandbox/tier", json={"tier": "unlinked"}).status_code == 422


def test_a_turn_streams_from_the_fake_model(client):
    web, sandbox = client
    first = sandbox.world.chat
    web.post("/api/sandbox/case", json={"case": "simple_request"})
    assert sandbox.chat.chat is sandbox.world.chat is not first
    r = web.post("/api/chat", json={"text": "can you get Dune?"})
    blocks = [b.splitlines() for b in r.text.strip().split("\n\n")]
    assert blocks[0] == ["event: text", f"data: {json.dumps({'text': '(fake reply)'})}"]
    assert blocks[-1][0] == "event: done"


def test_it_listens_on_localhost_only_and_reloads_on_changes(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)  # no `.env` here to read
    served = {}
    monkeypatch.setattr(sandbox_module.uvicorn, "run", lambda app, **kw: served.update(kw, app=app))
    for name in sandbox_module.CHOICES.values():
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("RAVEN_URL", "http://raven.elsewhere:8484")
    assert sandbox_module.main(["--model", "fake", "--case", "simple_request"]) == 0
    assert os.environ[sandbox_module.CHOICES["raven"]] == "http://raven.elsewhere:8484"
    assert served["host"] == "127.0.0.1" and served["reload"] and served["factory"]
    assert served["app"] == "sparrow.sandbox:app"
    assert served["reload_dirs"][0].endswith("sparrow")
    web = TestClient(sandbox_module.app())
    assert web.get("/api/sandbox").json()["case"]["id"] == "simple_request"
    with pytest.raises(SystemExit):
        sandbox_module.main(["--model", "fake", "--case", "nope"])


def test_it_runs_haiku_through_claude_code_and_needs_it_installed(monkeypatch, capsys, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sandbox_module.shutil, "which", lambda name: None)
    with pytest.raises(SystemExit):
        sandbox_module.main([])
    assert "isn't on PATH" in capsys.readouterr().err

    monkeypatch.setattr(sandbox_module.shutil, "which", lambda name: f"/usr/local/bin/{name}")
    monkeypatch.setattr(sandbox_module.uvicorn, "run", lambda app, **kw: None)
    for name in sandbox_module.CHOICES.values():
        monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("RAVEN_URL", raising=False)
    assert sandbox_module.main([]) == 0
    assert os.environ[sandbox_module.CHOICES["model"]] == "claude-haiku-5-5"
    assert os.environ[sandbox_module.CHOICES["raven"]] == "http://localhost:5174"
    sandbox = Sandbox("claude-haiku-5-5")
    assert isinstance(sandbox.client, ClaudeCodeModel)
    assert sandbox.world.chat.agent.client is sandbox.client
    assert Sandbox("fake").client is None


def test_the_real_raven_stands_in_for_every_case_fake():
    sandbox = Sandbox("fake", raven_url="http://localhost:5174")
    assert sandbox.state()["raven"] == "http://localhost:5174"
    sandbox.open("simple_request")
    assert sandbox.world.chat.agent.services.raven is sandbox.raven
