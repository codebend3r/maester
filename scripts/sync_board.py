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
from pathlib import Path

from catalog import EPICS
from tracker import (
    BOARD_TITLE,
    OWNER,
    REPO,
    ROADMAP_PATH,
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

# Apply order within one issue: an epic's checklist is ticked before it closes, and
# it closes before its status moves, so the auto-close workflow has nothing to do.
# The roadmap step comes after every issue, so it ticks the epics this run closes.
KIND_ORDER = ["board", "create-field", "add", "field", "tick", "close", "status"]

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


def fetch() -> dict:
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


def expected_fields(issue: dict) -> dict[str, str]:
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


def catalog_epic(issue: dict) -> dict | None:
    """The catalog epic an issue renders, or None for any other issue."""
    return next((e for e in EPICS if e["key"] == issue_key(issue["title"])), None)


def want_status(issue: dict, status: str | None, statuses: dict[int, str | None]):
    """The status the issue should have, or a reason a human has to decide, or None."""
    subs = issue["subIssues"]["nodes"]
    if is_closed(issue):
        if not is_done(issue):
            return None if status == "Done" else ("flag", "closed as not planned: Done or archive?")
        if not all(is_closed(s) for s in subs):
            return ("flag", "epic is closed but has open stories")
        return ("Done", "issue is closed")
    if status == "Done":
        return ("flag", "issue is open but shows Done: reopened, or moved too early?")
    if subs:
        started = [s for s in subs if is_closed(s) or statuses.get(s["number"]) == "In Progress"]
        if started and status != "In Progress":
            return ("In Progress", f"{len(started)} of {len(subs)} stories started or closed")
    elif prs := issue["closedByPullRequestsReferences"]["nodes"]:
        if status != "In Progress":
            return ("In Progress", "open PR " + ", ".join(f"#{p['number']}" for p in prs))
    if status is None:
        return ("Todo", "no status set")
    return None


def plan(board: dict) -> tuple[list[dict], list[dict]]:
    """Steps that would bring the board in line, and drift that needs a human decision."""
    if board["id"] is None:
        return [{"issue": None, "title": BOARD_TITLE, "kind": "board", "to": None,
                 "why": "no board with this title"}], []  # fmt: skip

    steps, flags = [], []
    options = {name: {o["name"] for o in f["options"]} for name, f in board["fields"].items()}
    missing = set()
    for field, wanted in field_options().items():
        if field not in options:
            steps.append({"issue": None, "title": f"{field} field", "kind": "create-field",
                          "field": field, "to": wanted, "why": "the board has no such field"})  # fmt: skip
        else:
            missing |= {(field, value) for value in wanted if value not in options[field]}

    closed = {key for key, issue in by_key(board["issues"]).items() if is_closed(issue)}
    statuses = {i["content"]["number"]: i["values"].get("Status") for i in board["items"]}
    for item in sorted(board["items"], key=lambda i: i["content"]["number"]):
        issue, values = item["content"], item["values"]
        n, title, subs = issue["number"], issue["title"], issue["subIssues"]["nodes"]
        step = {"issue": n, "title": title, "item": item["id"]}

        for field, value in expected_fields(issue).items():
            if values.get(field) == value or field not in options:
                continue
            if value not in options[field]:
                missing.add((field, value))
                continue
            steps.append(step | {"kind": "field", "field": field, "to": value,
                                 "why": f"{field} {values.get(field) or '(empty)'} → {value}"})  # fmt: skip

        if subs and (epic := catalog_epic(issue)):
            body = epic_body(epic, closed)
            if unticked(body) != unticked(issue["body"]):
                # Only the ticks are the board's to fix; the rest is the tracker's.
                flags.append({"issue": n, "title": title,
                              "why": "body differs from the catalog: run scripts/sync_tracker.py"})  # fmt: skip
            elif body != issue["body"]:
                steps.append(step | {"kind": "tick", "to": body, "why": "checklist out of date"})

        if issue["state"] == "OPEN" and subs and all(is_closed(s) for s in subs):
            done = ", ".join(f"#{s['number']}" for s in subs)
            steps.append(step | {"kind": "close", "to": f"All stories are closed: {done}.",
                                 "why": f"all {len(subs)} stories closed"})  # fmt: skip
            steps.append(step | {"kind": "status", "field": "Status", "to": "Done",
                                 "why": f"{values.get('Status') or '(empty)'} → Done"})  # fmt: skip
            continue

        want = want_status(issue, values.get("Status"), statuses)
        if want and want[0] == "flag":
            flags.append({"issue": n, "title": title, "why": want[1]})
        elif want and want[0] != values.get("Status"):
            steps.append(step | {"kind": "status", "field": "Status", "to": want[0],
                                 "why": f"{values.get('Status') or '(empty)'} → {want[0]}: {want[1]}"})  # fmt: skip

    on_board = {i["content"]["url"] for i in board["items"]}
    for issue in board["issues"]:
        if issue["url"] not in on_board:
            steps.append({"issue": issue["number"], "title": issue["title"], "kind": "add",
                          "to": issue["url"], "why": "not on the board"})  # fmt: skip

    steps.sort(key=lambda s: (s["issue"] or 0, KIND_ORDER.index(s["kind"])))
    flags += [{"issue": None, "title": f"{field} field",
               "why": f"no {value} option: add it on the board, then audit again"}
              for field, value in sorted(missing)]  # fmt: skip

    closing = {s["issue"] for s in steps if s["kind"] == "close"}
    current = ROADMAP_PATH.read_text() if ROADMAP_PATH.exists() else ""
    if render_roadmap(board["issues"], closing) != current:
        steps.append({"issue": None, "title": "docs/roadmap.md", "kind": "roadmap", "to": None,
                      "why": "boxes don't match the closed issues"})  # fmt: skip
    return steps, flags


def key(step: dict) -> tuple:
    return (step["issue"], step["kind"], step.get("field"))


def run(board: dict, step: dict) -> None:
    n, kind = str(step["issue"]), step["kind"]
    if kind == "board":
        out = gh("project", "create", "--owner", OWNER, "--title", BOARD_TITLE, "--format", "json")
        number = str(json.loads(out)["number"])
        gh("project", "link", number, "--owner", OWNER, "--repo", REPO)
    elif kind == "create-field":
        gh("project", "field-create", str(board["number"]), "--owner", OWNER,
           "--name", step["field"], "--data-type", "SINGLE_SELECT",
           "--single-select-options", ",".join(step["to"]))  # fmt: skip
    elif kind == "add":
        gh("project", "item-add", str(board["number"]), "--owner", OWNER, "--url", step["to"])
    elif kind == "tick":
        gh("issue", "edit", n, "-R", REPO, "--body-file", "-", input=step["to"])
    elif kind == "close":
        gh("issue", "close", n, "-R", REPO, "--reason", "completed", "--comment", step["to"])
    elif kind == "roadmap":
        # Rendered from live state, after this run's closes, not from the audit.
        ROADMAP_PATH.write_text(render_roadmap(list_issues()))
    else:
        field = board["fields"][step["field"]]
        option = next(o["id"] for o in field["options"] if o["name"] == step["to"])
        gh("project", "item-edit", "--project-id", board["id"], "--id", step["item"],
           "--field-id", field["id"], "--single-select-option-id", option)  # fmt: skip


def describe(step: dict) -> str:
    return {
        "board": "create the board and link it to the repo",
        "create-field": f"create the field with options {', '.join(step['to'] or [])}",
        "add": "add to the board",
        "field": f"set {step.get('field')} to {step['to']}",
        "tick": "update the story checklist",
        "close": "close the issue as completed",
        "status": f"set Status to {step['to']}",
        "roadmap": "re-render the checkboxes",
    }[step["kind"]]


def ref(step: dict, title: bool = False) -> str:
    """How a step's target reads: `#15`, `#15 [E2] Chat and identity` or `docs/roadmap.md`."""
    if step["issue"] is None:
        return step["title"]
    return f"#{step['issue']} {step['title']}" if title else f"#{step['issue']}"


def report(steps: list[dict], flags: list[dict]) -> None:
    if not steps and not flags:
        print("✓ board matches the issues, nothing to do")
        return
    if steps:
        print("| # | Issue | Change | Why |\n|---|---|---|---|")
        for i, s in enumerate(steps, 1):
            print(f"| {i} | {ref(s, title=True)} | {describe(s)} | {s['why']} |")
    if flags:
        print("\nNeeds a decision (never applied):")
        for f in flags:
            print(f"- {ref(f, title=True)}: {f['why']}")
    if steps:
        print(f"\nNothing changed. Plan saved to {PLAN_PATH}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="apply the saved plan")
    parser.add_argument("--only", help="comma-separated step numbers to apply, e.g. 1,3")
    args = parser.parse_args()

    board = fetch()
    steps, flags = plan(board)

    if not args.apply:
        report(steps, flags)
        PLAN_PATH.write_text(json.dumps(steps, indent=2))
        return

    if not PLAN_PATH.exists():
        sys.exit(f"✗ no saved plan at {PLAN_PATH}; run without --apply first")
    saved = json.loads(PLAN_PATH.read_text())
    picked = [int(x) for x in args.only.split(",")] if args.only else range(1, len(saved) + 1)
    if bad := [i for i in picked if not 1 <= i <= len(saved)]:
        sys.exit(f"✗ no step {bad[0]}; the saved plan has steps 1 to {len(saved)}")
    current = {key(s): s for s in steps}
    for i in picked:
        step = saved[i - 1]
        # Run the freshly planned step, not the saved one, so its data is current.
        if fresh := current.get(key(step)):
            run(board, fresh)
            print(f"✓ {i}. {ref(step)} {describe(fresh)}")
        else:
            print(f"· {i}. {ref(step)} {describe(step)}: already done, skipped")
    PLAN_PATH.unlink()


if __name__ == "__main__":
    main()
