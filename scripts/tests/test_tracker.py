import re

import pytest

import sync_board
import tracker
from catalog import EPICS, PRIORITIES, SIZES
from sync_tracker import edit_args, label_changes
from tracker import (
    by_key,
    epic_body,
    field_options,
    is_closed,
    is_done,
    issue_key,
    render_roadmap,
    unticked,
)

EPIC = EPICS[0]


def issue(number: int, title: str, state: str = "OPEN", reason: str | None = None, **rest):
    """An issue as `list_issues` returns it."""
    return {
        "number": number,
        "title": title,
        "id": f"I_{number}",
        "url": f"https://github.com/codebend3r/maester/issues/{number}",
        "body": "",
        "state": state,
        "stateReason": reason,
        "labels": [],
        "milestone": None,
    } | rest


class TestCatalog:
    def test_story_keys_are_unique_and_belong_to_their_epic(self):
        keys = [story["key"] for epic in EPICS for story in epic["stories"]]
        assert len(keys) == len(set(keys))
        for epic in EPICS:
            for story in epic["stories"]:
                assert re.fullmatch(rf"{epic['key']}\.\d+", story["key"])

    def test_stories_use_known_sizes_and_priorities(self):
        for epic in EPICS:
            for story in epic["stories"]:
                assert story["size"] in SIZES
                assert story["priority"] in PRIORITIES


class TestIssues:
    def test_issue_key_reads_the_title_prefix(self):
        assert issue_key("[E0.1] Project scaffold") == "E0.1"
        assert issue_key("[E3] Requests") == "E3"
        assert issue_key("A bug with no key") is None

    def test_by_key_leaves_out_issues_without_a_key(self):
        found = by_key([issue(1, "[E0] Foundation"), issue(2, "Loose bug")])
        assert list(found) == ["E0"]

    def test_closed_as_not_planned_is_closed_but_not_done(self):
        assert is_closed(issue(1, "x", "CLOSED", "NOT_PLANNED"))
        assert not is_done(issue(1, "x", "CLOSED", "NOT_PLANNED"))
        assert is_done(issue(1, "x", "CLOSED", "COMPLETED"))
        assert is_done(issue(1, "x", "CLOSED", ""))
        assert not is_done(issue(1, "x"))


class TestRendering:
    def test_epic_body_ticks_the_closed_stories_by_key(self):
        first, second = EPIC["stories"][:2]
        body = epic_body(EPIC, {first["key"]})
        assert f"- [x] {first['title']}" in body
        assert f"- [ ] {second['title']}" in body

    def test_unticked_compares_bodies_apart_from_ticks_and_line_endings(self):
        ticked = epic_body(EPIC, {story["key"] for story in EPIC["stories"]})
        assert unticked(ticked.replace("\n", "\r\n")) == epic_body(EPIC, set())

    def test_roadmap_links_and_ticks_from_the_issues(self):
        story = EPIC["stories"][0]
        issues = [
            issue(1, f"[{EPIC['key']}] {EPIC['title']}"),
            issue(2, f"[{story['key']}] {story['title']}", "CLOSED", "COMPLETED"),
        ]
        doc = render_roadmap(issues)
        assert f"- [x] {story['key']} {story['title']}" in doc
        assert "issues/2)" in doc
        assert f"- [ ] {EPIC['key']} {EPIC['title']} [#1]" in doc
        assert f"{EPIC['stories'][1]['key']} {EPIC['stories'][1]['title']}" in doc
        assert "(not synced)" in doc

    def test_roadmap_counts_issues_about_to_close(self):
        issues = [issue(1, f"[{EPIC['key']}] {EPIC['title']}")]
        assert f"- [x] {EPIC['key']} " in render_roadmap(issues, also_done={1})


class TestLabels:
    def test_a_reprioritized_story_loses_its_old_priority_and_size(self):
        current = {"story", "area:infra", "P1", "size:M", "bug", "hand-set"}
        add, remove = label_changes(current, ["story", "area:infra", "P0", "size:S"])
        assert add == ["P0", "size:S"]
        assert remove == ["P1", "size:M"]

    def test_an_unchanged_issue_is_not_edited(self):
        current = issue(
            2,
            "[E0.1] Project scaffold",
            body="body",
            labels=[{"name": "story"}, {"name": "P0"}],
            milestone={"title": "M1 Walking skeleton"},
        )
        args = ["story", "P0"]
        assert (
            edit_args(current, "[E0.1] Project scaffold", "body", args, "M1 Walking skeleton") == []
        )

    def test_a_changed_issue_is_edited_with_its_stale_labels_removed(self):
        current = issue(2, "[E0.1] Old title", labels=[{"name": "P1"}], milestone=None)
        args = edit_args(current, "[E0.1] Project scaffold", "body", ["P0"], "M1 Walking skeleton")
        assert args[args.index("--title") + 1] == "[E0.1] Project scaffold"
        assert args[args.index("--add-label") + 1] == "P0"
        assert args[args.index("--remove-label") + 1] == "P1"


class TestFieldOptions:
    def test_options_follow_the_catalog(self, monkeypatch):
        monkeypatch.setattr(tracker, "EPICS", [*EPICS, {"key": "E9"}])
        options = field_options()
        assert options["Epic"][-1] == "E9"
        assert options["Phase"][0] == "M1"
        assert options["Size"] == list(SIZES)
        assert options["Priority"] == list(PRIORITIES)


def board_field(name: str, values: list[str]) -> dict:
    return {
        "id": f"F_{name}",
        "name": name,
        "options": [{"id": f"O_{v}", "name": v} for v in values],
    }


def board_item(content: dict, **values: str) -> dict:
    """A board item; `content` is the issue as the board query returns it."""
    return {"id": f"PVTI_{content['number']}", "values": values, "content": content}


def content(number: int, title: str, body: str = "", subs=(), labels=(), milestone=None, **rest):
    return {
        "number": number,
        "title": title,
        "state": "OPEN",
        "stateReason": None,
        "body": body,
        "url": f"https://github.com/codebend3r/maester/issues/{number}",
        "labels": {"nodes": [{"name": name} for name in labels]},
        "milestone": {"title": milestone} if milestone else None,
        "subIssues": {"nodes": list(subs)},
        "closedByPullRequestsReferences": {"nodes": []},
    } | rest


@pytest.fixture
def roadmap(tmp_path, monkeypatch):
    """The roadmap file the audit compares against, already up to date for `issues`."""
    path = tmp_path / "roadmap.md"
    monkeypatch.setattr(sync_board, "ROADMAP_PATH", path)

    def write(issues: list[dict]) -> None:
        path.write_text(render_roadmap(issues))

    return write


def full_board(items: list[dict], issues: list[dict], **fields: list[str]) -> dict:
    defaults = field_options() | {"Status": ["Todo", "In Progress", "Done"]}
    chosen = defaults | fields
    return {
        "number": 1,
        "id": "PVT_1",
        "fields": {name: board_field(name, values) for name, values in chosen.items()},
        "items": items,
        "issues": issues,
    }


class TestBoardPlan:
    def test_a_missing_board_is_created_first(self):
        board = {"number": None, "id": None, "fields": {}, "items": [], "issues": []}
        steps, flags = sync_board.plan(board)
        assert [s["kind"] for s in steps] == ["board"]
        assert flags == []

    def test_a_missing_field_is_created_with_the_catalog_options(self, roadmap):
        story = EPIC["stories"][0]
        title = f"[{story['key']}] {story['title']}"
        issues = [issue(2, title)]
        roadmap(issues)
        board = full_board([board_item(content(2, title), Status="Todo")], issues)
        del board["fields"]["Epic"]
        steps, _ = sync_board.plan(board)
        create = [s for s in steps if s["kind"] == "create-field"]
        assert [(s["field"], s["to"]) for s in create] == [("Epic", field_options()["Epic"])]
        assert not [s for s in steps if s.get("field") == "Epic" and s["kind"] == "field"]

    def test_an_option_the_board_lacks_is_flagged_instead_of_crashing(self, roadmap):
        story = EPIC["stories"][0]
        title = f"[{story['key']}] {story['title']}"
        issues = [issue(2, title)]
        roadmap(issues)
        item = board_item(content(2, title, labels=["P0"]), Status="Todo")
        board = full_board([item], issues, Priority=["P1", "P2"])
        steps, flags = sync_board.plan(board)
        assert not [s for s in steps if s.get("field") == "Priority"]
        assert {"issue": None, "title": "Priority field",
                "why": "no P0 option: add it on the board, then audit again"} in flags  # fmt: skip

    def test_an_epic_checklist_is_rendered_ticked_from_its_closed_stories(self, roadmap):
        first, second = EPIC["stories"][:2]
        epic_title = f"[{EPIC['key']}] {EPIC['title']}"
        issues = [
            issue(1, epic_title),
            issue(2, f"[{first['key']}] {first['title']}", "CLOSED", "COMPLETED"),
            issue(3, f"[{second['key']}] {second['title']}"),
        ]
        roadmap(issues)
        subs = [
            {"number": 2, "title": issues[1]["title"], "state": "CLOSED"},
            {"number": 3, "title": issues[2]["title"], "state": "OPEN"},
        ]
        epic = content(1, epic_title, body=epic_body(EPIC, set()), subs=subs)
        board = full_board([board_item(epic, Status="In Progress", Epic=EPIC["key"])], issues)
        steps, flags = sync_board.plan(board)
        ticks = [s for s in steps if s["kind"] == "tick"]
        assert [s["to"] for s in ticks] == [epic_body(EPIC, {first["key"]})]
        assert flags == []

    def test_an_epic_body_that_drifted_from_the_catalog_is_flagged_not_ticked(self, roadmap):
        story = EPIC["stories"][0]
        epic_title = f"[{EPIC['key']}] {EPIC['title']}"
        issues = [issue(1, epic_title), issue(2, f"[{story['key']}] {story['title']}", "CLOSED")]
        roadmap(issues)
        subs = [{"number": 2, "title": issues[1]["title"], "state": "CLOSED"}]
        epic = content(1, epic_title, body="Edited by hand", subs=subs)
        board = full_board([board_item(epic, Status="In Progress", Epic=EPIC["key"])], issues)
        steps, flags = sync_board.plan(board)
        assert not [s for s in steps if s["kind"] == "tick"]
        assert [f["why"] for f in flags] == [
            "body differs from the catalog: run scripts/sync_tracker.py"
        ]

    def test_a_stale_roadmap_is_re_rendered(self, roadmap):
        story = EPIC["stories"][0]
        title = f"[{story['key']}] {story['title']}"
        roadmap([issue(2, title)])
        issues = [issue(2, title, "CLOSED", "COMPLETED")]
        item = board_item(content(2, title, state="CLOSED", stateReason="COMPLETED"), Status="Done")
        steps, _ = sync_board.plan(full_board([item], issues))
        assert steps[-1]["kind"] == "roadmap"
