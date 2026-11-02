import json
from types import SimpleNamespace

import pytest

import select_native_checks as selector


@pytest.mark.parametrize(
    ("projects", "expected"),
    [
        (set(), (False, False, False)),
        ({"@sparrow/api"}, (False, False, False)),
        ({"@raven/app"}, (True, False, False)),
        ({"@raven/music"}, (False, True, False)),
        ({"@raven/desktop"}, (False, False, True)),
        ({"@raven/mpv"}, (False, False, True)),
        ({"@raven/web"}, (False, False, True)),
        ({"@raven/server"}, (True, True, True)),
        ({"@raven/app", "@raven/music"}, (True, True, False)),
    ],
)
def test_project_selection(projects, expected):
    assert tuple(selector.select_groups(projects, []).values()) == expected


@pytest.mark.parametrize(
    "file",
    [
        "nx.json",
        "package.json",
        "bun.lock",
        "tsconfig.base.json",
        ".github/workflows/native-checks.yml",
        ".github/actions/raven-app-setup/action.yml",
        "scripts/ci_app_ios.sh",
        "scripts/select_native_checks.py",
        "tooling/tsconfig/node.json",
    ],
)
def test_shared_changes_force_all_checks(file):
    assert all(selector.select_groups(set(), [file]).values())


def test_base_skips_current_commit_and_non_ancestors(monkeypatch):
    checked = []

    def run(command, **_kwargs):
        checked.append(command[-2])
        return SimpleNamespace(returncode=int(command[-2] != "ancestor"))

    monkeypatch.setattr(selector.subprocess, "run", run)
    runs = [{"head_sha": sha} for sha in ("head", "future", "ancestor", "older")]
    assert selector.successful_base(runs, "head") == "ancestor"
    assert checked == ["future", "ancestor"]
    assert selector.successful_base([], "head") is None


@pytest.mark.parametrize("event", ["push", "workflow_dispatch"])
def test_no_base_runs_everything(monkeypatch, tmp_path, event):
    destination = tmp_path / "outputs"
    monkeypatch.setenv("GITHUB_SHA", "head")
    monkeypatch.setenv("GITHUB_EVENT_NAME", event)
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/repo")
    monkeypatch.setenv("GITHUB_OUTPUT", str(destination))
    calls = []

    def output(*command):
        calls.append(command)
        return json.dumps({"workflow_runs": []})

    monkeypatch.setattr(selector, "output", output)
    selector.main()
    assert destination.read_text() == "app=true\nmusic=true\ndesktop=true\n"
    assert len(calls) == int(event == "push")


def test_main_passes_explicit_shas_to_nx_and_writes_selection(monkeypatch, tmp_path):
    destination = tmp_path / "outputs"
    monkeypatch.setenv("GITHUB_SHA", "head")
    monkeypatch.setenv("GITHUB_EVENT_NAME", "push")
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/repo")
    monkeypatch.setenv("GITHUB_OUTPUT", str(destination))
    monkeypatch.setattr(selector, "successful_base", lambda _runs, _head: "base")
    calls = []

    def output(*command):
        calls.append(command)
        if command[0] == "gh":
            return json.dumps({"workflow_runs": [{"head_sha": "base"}]})
        if command[0] == "bunx":
            return json.dumps(["@raven/music"])
        return "apps/raven/music/src/app.tsx"

    monkeypatch.setattr(selector, "output", output)
    selector.main()
    assert "--base=base" in calls[1]
    assert "--head=head" in calls[1]
    assert calls[2] == ("git", "diff", "--name-only", "base", "head")
    assert destination.read_text() == "app=false\nmusic=true\ndesktop=false\n"
