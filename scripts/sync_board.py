#!/usr/bin/env python3
"""Bring the "maester roadmap" board back in line with the issues and their PRs.

The issues are the source of truth and the board follows them. The board's built-in
workflows miss transitions (issues closed by a PR can stay In Progress), so this audits
every item instead of trusting them. It also re-renders docs/roadmap.md when its boxes
no longer match the closed issues.

Read-only by default: prints a numbered plan and saves it. Applying re-audits first and
runs only the saved steps that are still needed, so a stale plan never undoes anything.

It also builds the board when it is missing: the first audit plans creating it, the next
its fields (with the options the catalog defines) and its items, the one after their fields.

    uv run python scripts/sync_board.py                     # audit, print and save the plan
    uv run python scripts/sync_board.py --apply             # apply the saved plan
    uv run python scripts/sync_board.py --apply --only 1,3  # apply part of it

Needs `gh` authenticated with the `project` scope (`gh auth refresh -s project`).
"""

import argparse
import json
import re
import sys
import tempfile
from collections.abc import Callable
from dataclasses import asdict, dataclass
from enum import StrEnum
from pathlib import Path
from typing import TypedDict

from catalog import EPICS, Epic
from tracker import (
    BOARD_TITLE,
    OWNER,
    REPO,
    ROADMAP_PATH,
    Issue,
    by_key,
    epic_body,
    field_options,
    gh,
    is_closed,
    is_done,
    issue_key,
    list_issues,
    render_roadmap,
    unticked,
)

EPIC_KEY = re.compile(r"E\d+")
PLAN_PATH = Path(tempfile.gettempdir()) / "maester-board-plan.json"


class StepKind(StrEnum):
    """What a step does, in apply order within one issue.

    An epic's checklist is ticked before it closes, and it closes before its status moves,
    so the auto-close workflow has nothing to do. The roadmap step comes after every issue,
    so it ticks the epics this run closes.
    """

    BOARD = "board"
    CREATE_FIELD = "create-field"
    ADD = "add"
    FIELD = "field"
    TICK = "tick"
    CLOSE = "close"
    STATUS = "status"
    ROADMAP = "roadmap"


KIND_ORDER = list(StepKind)
STATUS_FIELD = "Status"
DONE = "Done"
IN_PROGRESS = "In Progress"
TODO = "Todo"


@dataclass(frozen=True, kw_only=True)
class Step:
    """One change the audit plans; `to` is what it sets (a value, options, a body, a URL)."""

    issue: int | None
    title: str
    kind: StepKind
    why: str
    to: str | list[str] | None = None
    field: str | None = None
    item: str | None = None

    @classmethod
    def from_json(cls, raw: dict[str, object]) -> "Step":
        """A step from the saved plan; `ValueError` for one this version can't read."""
        issue, title, why, to = raw.get("issue"), raw.get("title"), raw.get("why"), raw.get("to")
        field, item = raw.get("field"), raw.get("item")
        if not (issue is None or isinstance(issue, int)):
            raise ValueError(f"a saved step's issue is not a number: {raw}")
        if not (isinstance(title, str) and isinstance(why, str)):
            raise ValueError(f"a saved step has no title or reason: {raw}")
        if not (to is None or isinstance(to, str) or isinstance(to, list)):
            raise ValueError(f"a saved step's target is unreadable: {raw}")
        if not (field is None or isinstance(field, str)) or not (
            item is None or isinstance(item, str)
        ):
            raise ValueError(f"a saved step's field or item is unreadable: {raw}")
        kind = StepKind(str(raw.get("kind")))
        targets = [str(t) for t in to] if isinstance(to, list) else to
        return cls(issue=issue, title=title, kind=kind, why=why, to=targets, field=field, item=item)

    @property
    def key(self) -> tuple[int | None, StepKind, str | None]:
        """What identifies a step across audits, so a saved one finds its fresh twin."""
        return (self.issue, self.kind, self.field)


@dataclass(frozen=True)
class Flag:
    """Drift a human has to decide; never applied."""

    issue: int | None
    title: str
    why: str


class Option(TypedDict):
    id: str
    name: str


class SingleSelectField(TypedDict):
    id: str
    name: str
    options: list[Option]


class Sub(TypedDict):
    number: int
    title: str
    state: str


class LabelNodes(TypedDict):
    nodes: list[dict[str, str]]


class SubNodes(TypedDict):
    nodes: list[Sub]


class PrNodes(TypedDict):
    nodes: list[dict[str, int]]


class BoardIssue(TypedDict):
    """An item's issue as `QUERY` reads it."""

    number: int
    title: str
    state: str
    stateReason: str | None
    body: str
    url: str
    labels: LabelNodes
    milestone: dict[str, str] | None
    subIssues: SubNodes
    closedByPullRequestsReferences: PrNodes


class BoardItem(TypedDict):
    id: str
    values: dict[str, str]
    content: BoardIssue


class Board(TypedDict):
    """The board's number and id (None without one), its fields, its items and every issue."""

    number: int | None
    id: str | None
    fields: dict[str, SingleSelectField]
    items: list[BoardItem]
    issues: list[Issue]


# What an issue's status should become and why, or `FLAG` and why a human must decide.
Want = tuple[str, str]
FLAG = "flag"

QUERY = """
query($owner: String!, $number: Int!, $after: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      fields(first: 50) {
        nodes { ... on ProjectV2SingleSelectField { id name options { id name } } }
      }
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ... on ProjectV2SingleSelectField { name } }
              }
            }
          }
          content {
            ... on Issue {
              number title state stateReason body url
              labels(first: 20) { nodes { name } }
              milestone { title }
              subIssues(first: 50) { nodes { number title state } }
              closedByPullRequestsReferences(first: 5, includeClosedPrs: false) {
                nodes { number }
              }
            }
          }
        }
      }
    }
  }
}"""


def find_board() -> int | None:
    """The board's number, found by its title, or None when it doesn't exist yet."""
    out = gh("project", "list", "--owner", OWNER, "--format", "json", "--limit", "100")
    boards = json.loads(out)["projects"]
    return next((b["number"] for b in boards if b["title"] == BOARD_TITLE), None)


def fetch() -> Board:
    """The board's number and id, its single-select fields, its issue items and every issue.

    Without a board, its number and id are None and it has no fields or items.
    """
    issues = list_issues()
    number = find_board()
    if number is None:
        return {"number": None, "id": None, "fields": {}, "items": [], "issues": issues}
    items, after = [], None
    while True:
        args = ["api", "graphql", "-f", f"query={QUERY}", "-f", f"owner={OWNER}"]
        args += ["-F", f"number={number}"] + (["-f", f"after={after}"] if after else [])
        project = json.loads(gh(*args))["data"]["user"]["projectV2"]
        items += [i for i in project["items"]["nodes"] if i["content"]]
        page = project["items"]["pageInfo"]
        if not page["hasNextPage"]:
            break
        after = page["endCursor"]
    fields = {f["name"]: f for f in project["fields"]["nodes"] if f}
    for item in items:
        values = item.pop("fieldValues")["nodes"]
        item["values"] = {v["field"]["name"]: v["name"] for v in values if v}
    return {"number": number, "id": project["id"], "fields": fields, "items": items,
            "issues": issues}  # fmt: skip


def expected_fields(issue: BoardIssue) -> dict[str, str]:
    """Epic, Phase, Size and Priority as the issue's title, milestone and labels imply."""
    labels = [label["name"] for label in issue["labels"]["nodes"]]
    out = {}
    if (key := issue_key(issue["title"])) and (epic := EPIC_KEY.match(key)):
        out["Epic"] = epic[0]
    if issue["milestone"]:
        out["Phase"] = issue["milestone"]["title"].split()[0]
    for name in labels:
        if name.startswith("size:"):
            out["Size"] = name[5:]
        elif re.fullmatch(r"P[0-2]", name):
            out["Priority"] = name
    return out


def catalog_epic(issue: BoardIssue) -> Epic | None:
    """The catalog epic an issue renders, or None for any other issue."""
    return next((e for e in EPICS if e["key"] == issue_key(issue["title"])), None)


def want_status(
    issue: BoardIssue, status: str | None, statuses: dict[int, str | None]
) -> Want | None:
    """The status the issue should have, or a reason a human has to decide, or None."""
    subs = issue["subIssues"]["nodes"]
    if is_closed(issue):
        if not is_done(issue):
            return None if status == DONE else (FLAG, "closed as not planned: Done or archive?")
        if not all(is_closed(s) for s in subs):
            return (FLAG, "epic is closed but has open stories")
        return (DONE, "issue is closed")
    if status == DONE:
        return (FLAG, "issue is open but shows Done: reopened, or moved too early?")
    if subs:
        started = [s for s in subs if is_closed(s) or statuses.get(s["number"]) == IN_PROGRESS]
        if started and status != IN_PROGRESS:
            return (IN_PROGRESS, f"{len(started)} of {len(subs)} stories started or closed")
    elif prs := issue["closedByPullRequestsReferences"]["nodes"]:
        if status != IN_PROGRESS:
            return (IN_PROGRESS, "open PR " + ", ".join(f"#{p['number']}" for p in prs))
    if status is None:
        return (TODO, "no status set")
    return None


@dataclass(frozen=True)
class ItemStep:
    """Builds the steps for one board item, each naming its issue and item."""

    item: BoardItem

    def __call__(self, *, kind: StepKind, why: str, to: str, field: str | None = None) -> Step:
        issue = self.item["content"]
        return Step(
            issue=issue["number"],
            title=issue["title"],
            kind=kind,
            why=why,
            to=to,
            field=field,
            item=self.item["id"],
        )


def plan(board: Board) -> tuple[list[Step], list[Flag]]:
    """Steps that would bring the board in line, and drift that needs a human decision."""
    if board["id"] is None:
        return [
            Step(issue=None, title=BOARD_TITLE, kind=StepKind.BOARD, why="no board with this title")
        ], []

    steps: list[Step] = []
    flags: list[Flag] = []
    options = {name: {o["name"] for o in f["options"]} for name, f in board["fields"].items()}
    missing: set[tuple[str, str]] = set()
    for field, wanted in field_options().items():
        if field not in options:
            steps.append(Step(issue=None, title=f"{field} field", kind=StepKind.CREATE_FIELD,
                              why="the board has no such field", to=wanted, field=field))  # fmt: skip
        else:
            missing |= {(field, value) for value in wanted if value not in options[field]}

    closed = {key for key, issue in by_key(board["issues"]).items() if is_closed(issue)}
    statuses = {i["content"]["number"]: i["values"].get(STATUS_FIELD) for i in board["items"]}
    for item in sorted(board["items"], key=lambda i: i["content"]["number"]):
        issue, values = item["content"], item["values"]
        n, title, subs = issue["number"], issue["title"], issue["subIssues"]["nodes"]
        status = values.get(STATUS_FIELD)
        step = ItemStep(item)

        for field, value in expected_fields(issue).items():
            if values.get(field) == value or field not in options:
                continue
            if value not in options[field]:
                missing.add((field, value))
                continue
            why = f"{field} {values.get(field) or '(empty)'} → {value}"
            steps.append(step(kind=StepKind.FIELD, why=why, to=value, field=field))

        if subs and (epic := catalog_epic(issue)):
            body = epic_body(epic, closed)
            if unticked(body) != unticked(issue["body"]):
                # Only the ticks are the board's to fix; the rest is the tracker's.
                flags.append(Flag(n, title,
                                  "body differs from the catalog: run scripts/sync_tracker.py"))  # fmt: skip
            elif body != issue["body"]:
                steps.append(step(kind=StepKind.TICK, why="checklist out of date", to=body))

        if issue["state"] == "OPEN" and subs and all(is_closed(s) for s in subs):
            done = ", ".join(f"#{s['number']}" for s in subs)
            steps.append(step(kind=StepKind.CLOSE, why=f"all {len(subs)} stories closed",
                              to=f"All stories are closed: {done}."))  # fmt: skip
            steps.append(step(kind=StepKind.STATUS, why=f"{status or '(empty)'} → {DONE}", to=DONE,
                              field=STATUS_FIELD))  # fmt: skip
            continue

        want = want_status(issue, status, statuses)
        if want and want[0] == FLAG:
            flags.append(Flag(n, title, want[1]))
        elif want and want[0] != status:
            why = f"{status or '(empty)'} → {want[0]}: {want[1]}"
            steps.append(step(kind=StepKind.STATUS, why=why, to=want[0], field=STATUS_FIELD))

    on_board = {i["content"]["url"] for i in board["items"]}
    steps += [
        Step(
            issue=issue["number"],
            title=issue["title"],
            kind=StepKind.ADD,
            why="not on the board",
            to=issue["url"],
        )
        for issue in board["issues"]
        if issue["url"] not in on_board
    ]

    steps.sort(key=lambda s: (s.issue or 0, KIND_ORDER.index(s.kind)))
    flags += [Flag(None, f"{field} field",
                   f"no {value} option: add it on the board, then audit again")
              for field, value in sorted(missing)]  # fmt: skip

    closing = {s.issue for s in steps if s.kind == StepKind.CLOSE and s.issue is not None}
    current = ROADMAP_PATH.read_text() if ROADMAP_PATH.exists() else ""
    if render_roadmap(board["issues"], closing) != current:
        steps.append(Step(issue=None, title="docs/roadmap.md", kind=StepKind.ROADMAP,
                          why="boxes don't match the closed issues"))  # fmt: skip
    return steps, flags


def target(step: Step) -> str:
    """A step's single target, for the kinds that set one value, body or URL."""
    if not isinstance(step.to, str):
        raise ValueError(f"{step.kind} step for {step.title} has no target")
    return step.to


def run_board(board: Board, step: Step) -> None:
    out = gh("project", "create", "--owner", OWNER, "--title", BOARD_TITLE, "--format", "json")
    number = str(json.loads(out)["number"])
    gh("project", "link", number, "--owner", OWNER, "--repo", REPO)


def run_create_field(board: Board, step: Step) -> None:
    options = step.to if isinstance(step.to, list) else []
    gh("project", "field-create", str(board["number"]), "--owner", OWNER,
       "--name", str(step.field), "--data-type", "SINGLE_SELECT",
       "--single-select-options", ",".join(options))  # fmt: skip


def run_add(board: Board, step: Step) -> None:
    gh("project", "item-add", str(board["number"]), "--owner", OWNER, "--url", target(step))


def run_tick(board: Board, step: Step) -> None:
    gh("issue", "edit", str(step.issue), "-R", REPO, "--body-file", "-", input=target(step))


def run_close(board: Board, step: Step) -> None:
    gh("issue", "close", str(step.issue), "-R", REPO, "--reason", "completed",
       "--comment", target(step))  # fmt: skip


def run_roadmap(board: Board, step: Step) -> None:
    # Rendered from live state, after this run's closes, not from the audit.
    ROADMAP_PATH.write_text(render_roadmap(list_issues()))


def run_field(board: Board, step: Step) -> None:
    """Set one of the item's single-select fields (Status included) to the step's value."""
    field = board["fields"][str(step.field)]
    option = next(o["id"] for o in field["options"] if o["name"] == target(step))
    gh("project", "item-edit", "--project-id", str(board["id"]), "--id", str(step.item),
       "--field-id", field["id"], "--single-select-option-id", option)  # fmt: skip


RUNS: dict[StepKind, Callable[[Board, Step], None]] = {
    StepKind.BOARD: run_board,
    StepKind.CREATE_FIELD: run_create_field,
    StepKind.ADD: run_add,
    StepKind.FIELD: run_field,
    StepKind.TICK: run_tick,
    StepKind.CLOSE: run_close,
    StepKind.STATUS: run_field,
    StepKind.ROADMAP: run_roadmap,
}

DESCRIPTIONS: dict[StepKind, Callable[[Step], str]] = {
    StepKind.BOARD: lambda s: "create the board and link it to the repo",
    StepKind.CREATE_FIELD: lambda s: (
        f"create the field with options {', '.join(s.to if isinstance(s.to, list) else [])}"
    ),
    StepKind.ADD: lambda s: "add to the board",
    StepKind.FIELD: lambda s: f"set {s.field} to {s.to}",
    StepKind.TICK: lambda s: "update the story checklist",
    StepKind.CLOSE: lambda s: "close the issue as completed",
    StepKind.STATUS: lambda s: f"set Status to {s.to}",
    StepKind.ROADMAP: lambda s: "re-render the checkboxes",
}


def run(board: Board, step: Step) -> None:
    RUNS[step.kind](board, step)


def describe(step: Step) -> str:
    return DESCRIPTIONS[step.kind](step)


def ref(entry: Step | Flag, title: bool = False) -> str:
    """How a step's target reads: `#15`, `#15 [E2] Chat and identity` or `docs/roadmap.md`."""
    if entry.issue is None:
        return entry.title
    return f"#{entry.issue} {entry.title}" if title else f"#{entry.issue}"


def report(steps: list[Step], flags: list[Flag]) -> None:
    if not steps and not flags:
        print("✓ board matches the issues, nothing to do")
        return
    if steps:
        print("| # | Issue | Change | Why |\n|---|---|---|---|")
        for i, s in enumerate(steps, 1):
            print(f"| {i} | {ref(s, title=True)} | {describe(s)} | {s.why} |")
    if flags:
        print("\nNeeds a decision (never applied):")
        for f in flags:
            print(f"- {ref(f, title=True)}: {f.why}")
    if steps:
        print(f"\nNothing changed. Plan saved to {PLAN_PATH}")


def save_plan(steps: list[Step]) -> None:
    PLAN_PATH.write_text(json.dumps([asdict(s) for s in steps], indent=2))


def load_plan() -> list[Step]:
    """The saved plan; exits when it is missing or this version can't read it."""
    if not PLAN_PATH.exists():
        sys.exit(f"✗ no saved plan at {PLAN_PATH}; run without --apply first")
    raw = json.loads(PLAN_PATH.read_text())
    try:
        if not isinstance(raw, list):
            raise ValueError("the saved plan is not a list of steps")
        return [Step.from_json(s) for s in raw if isinstance(s, dict)]
    except ValueError as error:
        sys.exit(f"✗ the saved plan at {PLAN_PATH} can't be read ({error}); audit again")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="apply the saved plan")
    parser.add_argument("--only", help="comma-separated step numbers to apply, e.g. 1,3")
    args = parser.parse_args()

    board = fetch()
    steps, flags = plan(board)

    if not args.apply:
        report(steps, flags)
        save_plan(steps)
        return

    saved = load_plan()
    picked = [int(x) for x in args.only.split(",")] if args.only else range(1, len(saved) + 1)
    if bad := [i for i in picked if not 1 <= i <= len(saved)]:
        sys.exit(f"✗ no step {bad[0]}; the saved plan has steps 1 to {len(saved)}")
    current = {s.key: s for s in steps}
    for i in picked:
        step = saved[i - 1]
        # Run the freshly planned step, not the saved one, so its data is current.
        if fresh := current.get(step.key):
            run(board, fresh)
            print(f"✓ {i}. {ref(step)} {describe(fresh)}")
        else:
            print(f"· {i}. {ref(step)} {describe(step)}: already done, skipped")
    PLAN_PATH.unlink()


if __name__ == "__main__":
    main()
